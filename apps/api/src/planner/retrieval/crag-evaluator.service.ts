import { Injectable } from '@nestjs/common';
import { FOOD_PREFERENCES, type Coordinates } from '@tripick/types';
import { inferPlaceTags, normalizeDestinationRegion, tasteTagsToKeywords } from './place-seeds';
import { NEUTRAL_POPULARITY } from './naver-search.service';
import type { CandidatePlace, CragScore, RawPlaceCandidate, RetrievalContext } from './types';

// 비(날씨) 재계획에서 실내 후보를 우대할 때 쓰는 태그.
// 식음(FOOD 전체)은 실내라 어휘에서 직접 파생 — 새 음식 태그를 추가해도 자동 포함된다.
// mood·environment 는 실내로 볼 수 있는 값만 골라 넣는다 (전시·가족·핫플·프리미엄·도심·온천).
const INDOOR_TAGS = new Set<string>([
  ...FOOD_PREFERENCES,
  'cultural',
  'family',
  'trendy',
  'luxury',
  'city',
  'hotspring',
]);

@Injectable()
export class CragEvaluatorService {
  rank(candidates: RawPlaceCandidate[], context: RetrievalContext): CandidatePlace[] {
    return this.deduplicate(candidates)
      .map((candidate) => this.evaluate(candidate, context))
      .sort((a, b) => b.confidence - a.confidence);
  }

  selectTopDiverse(candidates: CandidatePlace[], limit: number): CandidatePlace[] {
    const selected: CandidatePlace[] = [];
    const categoryCount = new Map<string, number>();

    for (const candidate of candidates) {
      const count = categoryCount.get(candidate.category) ?? 0;
      if (count >= 2 && selected.length < Math.min(limit, 6)) continue;
      selected.push(candidate);
      categoryCount.set(candidate.category, count + 1);
      if (selected.length >= limit) return selected;
    }

    for (const candidate of candidates) {
      if (selected.some((item) => item.id === candidate.id)) continue;
      selected.push(candidate);
      if (selected.length >= limit) break;
    }

    return selected;
  }

  private evaluate(candidate: RawPlaceCandidate, context: RetrievalContext): CandidatePlace {
    const tags = candidate.tags?.length ? candidate.tags : inferPlaceTags(candidate);
    const matchedTags = this.matchedTags(tags, context);
    const penalties: string[] = [];
    const retrieval = this.retrievalScore(candidate);
    const personalization = this.personalizationScore(candidate);
    const taste = this.tasteScore(tags, context, personalization);
    const locality = this.localityScore(candidate, context, penalties);
    const contextScore = this.contextScore(candidate, tags, context);
    const availability = this.availabilityScore(candidate, context, penalties);
    const dataQuality = this.dataQualityScore(candidate, penalties);
    const popularity = this.popularityScore(candidate, context, penalties);
    // 네이버 인지도 항(0.12)을 더해 마이너 장소를 후순위로 민다.
    // 인덱스 비활성 시 popularity=중립값이라 나머지 항 비율만 유지되고 순위는 불변.
    const total = this.clamp(
      retrieval * 0.24 +
        taste * 0.2 +
        popularity * 0.12 +
        locality * 0.16 +
        contextScore * 0.13 +
        availability * 0.09 +
        dataQuality * 0.06,
    );

    const crag: CragScore = {
      total,
      retrieval,
      taste,
      locality,
      context: contextScore,
      availability,
      dataQuality,
      popularity,
      matchedTags,
      penalties,
      ...(personalization !== undefined ? { personalization } : {}),
    };

    return {
      ...candidate,
      tags,
      confidence: Number(total.toFixed(3)),
      reason: this.reason(candidate, crag, context),
      crag,
    };
  }

  private retrievalScore(candidate: RawPlaceCandidate): number {
    if (candidate.similarity !== undefined) {
      return this.clamp((candidate.similarity + 1) / 2);
    }
    if (candidate.source === 'kakao') return 0.66;
    return 0.58;
  }

  private tasteScore(
    tags: string[],
    context: RetrievalContext,
    personalization?: number,
  ): number {
    const neutralScore = 0.56;
    const preferred = tasteTagsToKeywords(context.tasteTags);
    const rawTagScore =
      preferred.length === 0
        ? neutralScore
        : this.clamp(0.35 + preferred.filter((tag) => tags.includes(tag)).length / preferred.length);
    const rawConfidence = context.tasteTags?.confidence ?? 0;
    const tasteConfidence = Number.isFinite(rawConfidence) ? this.clamp(rawConfidence) : 0;
    // 사진 분석 confidence 만큼만 태그 매칭 점수를 중립값에서 움직인다.
    const tagScore = neutralScore + (rawTagScore - neutralScore) * tasteConfidence;
    // 취향 벡터 유사도가 있으면 태그 매칭보다 우선해 리랭킹 (벡터 기반 개인화)
    if (personalization === undefined) return tagScore;
    return this.clamp(tagScore * 0.45 + personalization * 0.55);
  }

  /**
   * 네이버 추천 글 대중 인지도 점수. 인덱스가 없으면 중립값이라 순위에 영향 없음.
   * 언급 0(마이너 장소)이면 낮은 점수 → 소프트 감점, 제거는 아니다.
   */
  private popularityScore(
    candidate: RawPlaceCandidate,
    context: RetrievalContext,
    penalties: string[],
  ): number {
    const index = context.popularityIndex;
    if (!index || index.docCount === 0) return NEUTRAL_POPULARITY;
    const score = index.score(candidate.name);
    if (index.mentions(candidate.name) === 0) penalties.push('naver-unmentioned');
    return score;
  }

  /** 저장된 취향 벡터와의 코사인 유사도(-1~1)를 0~1 점수로 정규화 */
  private personalizationScore(candidate: RawPlaceCandidate): number | undefined {
    if (candidate.preferenceSimilarity === undefined) return undefined;
    return this.clamp((candidate.preferenceSimilarity + 1) / 2);
  }

  private localityScore(
    candidate: RawPlaceCandidate,
    context: RetrievalContext,
    penalties: string[],
  ): number {
    const region = normalizeDestinationRegion(context.destination);
    if (region === 'default') return 0.62;
    const haystack = `${candidate.name} ${candidate.address} ${candidate.destinationRegion ?? ''}`.toLowerCase();
    const regionMatches =
      candidate.destinationRegion?.toLowerCase() === region ||
      this.regionKeywords(region).some((keyword) => haystack.includes(keyword));
    if (regionMatches) return 0.92;
    penalties.push('destination-mismatch');
    return 0.32;
  }

  private contextScore(
    candidate: RawPlaceCandidate,
    tags: string[],
    context: RetrievalContext,
  ): number {
    const triggerScore = this.triggerScore(candidate, tags, context);
    const distanceScore = context.currentLocation
      ? this.distanceScore(candidate.coordinates, context.currentLocation)
      : 0.62;
    return this.clamp(triggerScore * 0.65 + distanceScore * 0.35);
  }

  private triggerScore(
    candidate: RawPlaceCandidate,
    tags: string[],
    context: RetrievalContext,
  ): number {
    if (context.trigger === 'weather') {
      return tags.some((tag) => INDOOR_TAGS.has(tag)) ? 0.9 : 0.42;
    }
    if (context.trigger === 'deviation') {
      return 0.72;
    }
    return 0.64;
  }

  private availabilityScore(
    candidate: RawPlaceCandidate,
    context: RetrievalContext,
    penalties: string[],
  ): number {
    if (!candidate.openingHours) return 0.58;
    if (!context.startAt) return 0.68;

    const match = candidate.openingHours.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!match) return 0.58;

    const [, startHour, startMinute, endHour, endMinute] = match;
    const visitMinutes = this.kstMinutes(context.startAt);
    const start = Number(startHour) * 60 + Number(startMinute);
    const end = Number(endHour) * 60 + Number(endMinute);
    if (visitMinutes >= start && visitMinutes <= end) return 0.95;
    penalties.push('closed-at-target-time');
    return 0.25;
  }

  private dataQualityScore(candidate: RawPlaceCandidate, penalties: string[]): number {
    let score = 0.35;
    if (candidate.name) score += 0.15;
    if (candidate.address) score += 0.15;
    if (candidate.coordinates) score += 0.2;
    if (candidate.category) score += 0.1;
    if (candidate.kakaoPlaceId || candidate.tourismApiId) score += 0.05;
    if (!candidate.address) penalties.push('missing-address');
    return this.clamp(score);
  }

  private distanceScore(from: Coordinates, to: Coordinates): number {
    const km = this.distanceKm(from, to);
    if (km <= 0.5) return 0.95;
    if (km <= 2) return 0.82;
    if (km <= 5) return 0.62;
    if (km <= 12) return 0.42;
    return 0.25;
  }

  private matchedTags(tags: string[], context: RetrievalContext): string[] {
    const preferred = new Set(tasteTagsToKeywords(context.tasteTags));
    return tags.filter((tag) => preferred.has(tag));
  }

  private reason(candidate: RawPlaceCandidate, score: CragScore, context: RetrievalContext): string {
    const matched = score.matchedTags.length > 0
      ? `선호 태그 ${score.matchedTags.join(', ')} 일치`
      : `${context.destination} 동선 후보`;
    const confidence = Math.round(score.total * 100);
    const sourceLabel = {
      pgvector: 'pgvector',
      kakao: 'Kakao Local',
      seed: 'seed fallback',
    }[candidate.source];
    const fallback = candidate.source === 'pgvector' ? '' : ', 검색 보정 fallback 반영';
    const personalized =
      score.personalization !== undefined && score.personalization >= 0.6
        ? `, 취향 벡터 ${Math.round(score.personalization * 100)}% 부합`
        : '';
    // NEUTRAL_POPULARITY(0.5) 초과는 네이버 추천 글에 실제 언급된 장소를 뜻한다.
    const popular = score.popularity > NEUTRAL_POPULARITY ? ', 네이버 추천 글 다수 언급' : '';
    return `${matched}, ${sourceLabel} confidence ${confidence}%${personalized}${popular}${fallback}`;
  }

  private deduplicate(candidates: RawPlaceCandidate[]): RawPlaceCandidate[] {
    const seen = new Set<string>();
    const unique: RawPlaceCandidate[] = [];
    for (const candidate of candidates) {
      const key = candidate.kakaoPlaceId ?? `${candidate.name}:${candidate.address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(candidate);
    }
    return unique;
  }

  private regionKeywords(region: string): string[] {
    return {
      seoul: ['서울', 'seoul'],
      busan: ['부산', 'busan'],
      jeju: ['제주', 'jeju'],
      gyeongju: ['경주', 'gyeongju'],
      default: [],
    }[region] ?? [];
  }

  private kstMinutes(date: Date): number {
    return ((date.getUTCHours() * 60 + date.getUTCMinutes()) + 9 * 60) % (24 * 60);
  }

  private distanceKm(from: Coordinates, to: Coordinates): number {
    const latDelta = (from.lat - to.lat) * 111;
    const lngDelta = (from.lng - to.lng) * 88;
    return Math.sqrt(latDelta ** 2 + lngDelta ** 2);
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
