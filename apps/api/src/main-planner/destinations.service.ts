import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { DestinationSuggestionDto } from '@tripick/types';
import {
  PlaceEmbeddingRepository,
  type RegionRecommendation,
} from '../planner/retrieval/place-embedding.repository';
import { NaverSearchService } from '../planner/retrieval/naver-search.service';
import type { PopularityIndex } from '../planner/retrieval/types';
import { regionSearchStem } from '../planner/retrieval/place-seeds';
import { PreferencesService } from '../preferences/preferences.service';

/** place_embeddings 에 정규화 슬러그로 저장된 지역 → 표시용 한글명 */
const SLUG_TO_KO: Record<string, string> = {
  seoul: '서울',
  busan: '부산',
  jeju: '제주',
  gyeongju: '경주',
};

/**
 * KTO ldongCode2 시도 원본명 → 표시용 짧은 라벨.
 * 접미사 제거만으론 '충청북도'→'충청북' 처럼 정식 약칭('충북')을 못 만들고,
 * 특히 코드 12 는 원본이 '전남광주통합특별시'(광주+전남 병합)로 깨져 와
 * 접미사만 떼면 '전남광주통합' 이 남는다 — 정식명은 명시적으로 매핑한다.
 */
const SIDO_DISPLAY: Record<string, string> = {
  서울특별시: '서울',
  부산광역시: '부산',
  대구광역시: '대구',
  인천광역시: '인천',
  광주광역시: '광주',
  대전광역시: '대전',
  울산광역시: '울산',
  세종특별자치시: '세종',
  경기도: '경기',
  강원도: '강원',
  강원특별자치도: '강원',
  충청북도: '충북',
  충청남도: '충남',
  전라북도: '전북',
  전북특별자치도: '전북',
  전라남도: '전남',
  경상북도: '경북',
  경상남도: '경남',
  제주특별자치도: '제주',
  // 코드 12 병합 버킷: 여수·순천·담양 등 전남 시군이 대다수라 '전남'으로 표시한다.
  전남광주통합특별시: '전남',
};

/**
 * destination_region 원본값(시도명 or 슬러그) → 표시용 지역명. 'default' 등은 제외(null).
 * 표시용은 매칭용 regionStem 과 달리 도·시까지 모두 떼어 짧은 라벨로 만든다.
 * (슬러그 'jeju'→'제주' 와 시도명 '제주특별자치도'→'제주' 를 같은 라벨로 맞춰
 *  후보 그룹이 '제주'/'제주도' 로 갈리지 않게 한다.)
 * 정식 시도명은 SIDO_DISPLAY 로 정규 약칭(충북·경남 등)을 주고, 그 외에만 접미사 제거로 폴백한다.
 * 예: '부산광역시'→'부산', '충청북도'→'충북', '경기도'→'경기'
 */
function displayRegionName(raw: string): string | null {
  const trimmed = raw.trim();
  const key = trimmed.toLowerCase();
  if (!trimmed || key === 'default') return null;
  if (SLUG_TO_KO[key]) return SLUG_TO_KO[key];
  if (SIDO_DISPLAY[trimmed]) return SIDO_DISPLAY[trimmed];
  const label = (trimmed.split(/\s+/)[0] ?? '').replace(
    /(특별자치도|특별자치시|특별시|광역시|자치도|자치시|도|시|군|구)$/,
    '',
  );
  return label || raw;
}

/** 같은 시도 내 두 후보 중 next 를 대표로 바꿔야 하는지. 시군구 있는 후보 우선, 같은 급이면 고점수. */
function preferSigungu(cur: RegionRecommendation, next: RegionRecommendation): boolean {
  const curHas = !!cur.sigungu?.trim();
  const nextHas = !!next.sigungu?.trim();
  if (curHas !== nextHas) return nextHas;
  return next.score > cur.score;
}

/** 취향 점수 맵과 후보를 같은 어간 키로 맞추기 위한 정규화(어간·공백 제거·소문자). */
function prefKey(name: string): string {
  return (regionSearchStem(name) || name).replace(/\s+/g, '').toLowerCase();
}

/** 계절 코퍼스에서 파싱한 추천 후보 1건 (표시용 DTO + 취향 매칭 키 + 언급 점수). */
interface SeasonalCandidate {
  dto: DestinationSuggestionDto;
  /** preferenceScoreMap 과 대조할 어간 키 */
  key: string;
  /** 이번 달 추천 글 언급 빈도 점수 (0~1) */
  seasonalScore: number;
}

/** ldongCode2 응답 아이템 (법정동 시도 / 시군구 공통). code=lDongRegnCd/lDongSignguCd */
interface AreaCodeItem {
  code: string | number;
  name: string;
}

interface AreaCodeResponse {
  response?: {
    body?: {
      items?: '' | { item?: AreaCodeItem | AreaCodeItem[] };
    };
  };
}

/**
 * 입력 전(빈 검색) 기본 노출용 인기 여행지 우선순위.
 * 각 토큰과 name이 매칭되는 첫 후보를 순서대로 골라 상단에 배치한다.
 */
const POPULAR_NAMES = [
  '제주',
  '부산',
  '강릉',
  '경주',
  '여수',
  '전주',
  '속초',
  '서울',
];

/** items가 '' | 단일객체 | 배열로 오는 data.go.kr 응답 정규화 */
function toItemArray(items: AreaCodeResponse['response']): AreaCodeItem[] {
  const raw = items?.body?.items;
  if (!raw || !raw.item) return [];
  return Array.isArray(raw.item) ? raw.item : [raw.item];
}

/**
 * 한국관광공사 국문관광정보 서비스(GW)의 ldongCode2(법정동 코드)를 이용해
 * 시도 + 시군구 여행 지역 목록을 구성한다.
 * 지역 목록은 거의 변하지 않으므로 최초 1회 조회 후 메모리에 캐싱한다.
 */
@Injectable()
export class DestinationsService {
  private readonly logger = new Logger(DestinationsService.name);
  private readonly BASE_URL = 'https://apis.data.go.kr/B551011/KorService2/ldongCode2';
  private cache: Promise<DestinationSuggestionDto[]> | null = null;

  private static readonly REC_TOP_K = 12;
  private static readonly REC_MIN_PLACES = 5;
  private static readonly REC_LIMIT = 8;
  /** 시도별 대표로 접기 전에 받아둘 후보(시도·시군구) 수 */
  private static readonly REC_CANDIDATES = 100;

  /** 계절 후보를 취향으로 랭킹할 때의 가중: 취향 우선, 계절 언급 보조. */
  private static readonly PREF_WEIGHT = 0.7;
  private static readonly SEASONAL_WEIGHT = 0.3;
  /** 취향 점수가 없는(시딩 안 된) 지역에 주는 중립값. */
  private static readonly NEUTRAL_PREF = 0.5;

  constructor(
    private readonly config: ConfigService,
    private readonly preferences: PreferencesService,
    private readonly placeEmbeddings: PlaceEmbeddingRepository,
    private readonly naver: NaverSearchService,
  ) {}

  async search(query: string): Promise<DestinationSuggestionDto[]> {
    const all = await this.getAll();
    const q = query.trim().toLowerCase();
    if (!q) return this.popular(all);
    return all
      .filter(
        (d) => d.name.toLowerCase().includes(q) || d.region.toLowerCase().includes(q),
      )
      .slice(0, 10);
  }

  /**
   * 메인 노출용 추천 여행지. 네이버 검색으로 이번 달 "국내 여행지 추천" 코퍼스를 모아
   * 그 안에 실제로 언급된 여행지만 후보로 추린 뒤(파서), 사용자 취향으로 랭킹한다.
   * 네이버 키가 없거나 코퍼스가 비면 기존 취향/인기 로직으로 폴백한다.
   */
  async recommend(userId: string): Promise<DestinationSuggestionDto[]> {
    const all = await this.getAll();
    const seasonal = await this.naver.getSeasonalDestinationIndex();
    if (seasonal.docCount > 0) {
      const picked = await this.recommendSeasonal(all, userId, seasonal);
      if (picked.length > 0) return picked;
    }
    return this.recommendByPreference(all, userId);
  }

  /**
   * 이번 달 추천 코퍼스에 언급된 여행지를 취향으로 랭킹한다.
   * 취향 점수(있으면)를 주 신호로, 계절 언급 빈도를 보조 신호로 결합한다.
   * 취향 벡터가 없으면(온보딩 전) 계절 언급 순으로만 랭킹한다.
   * 후보가 목표 개수보다 적으면 인기 여행지로 채운다.
   */
  private async recommendSeasonal(
    all: DestinationSuggestionDto[],
    userId: string,
    seasonal: PopularityIndex,
  ): Promise<DestinationSuggestionDto[]> {
    const candidates = this.parseSeasonalCandidates(all, seasonal);
    if (candidates.length === 0) return [];

    const prefScore = await this.preferenceScoreMap(userId);
    const hasPreference = prefScore.size > 0;
    const ranked = candidates
      .map((c) => {
        const pref = prefScore.get(c.key) ?? DestinationsService.NEUTRAL_PREF;
        const combined = hasPreference
          ? pref * DestinationsService.PREF_WEIGHT +
            c.seasonalScore * DestinationsService.SEASONAL_WEIGHT
          : c.seasonalScore;
        return { dto: c.dto, combined };
      })
      .sort((a, b) => b.combined - a.combined);

    const picked: DestinationSuggestionDto[] = [];
    const seen = new Set<string>();
    for (const r of ranked) {
      if (picked.length >= DestinationsService.REC_LIMIT) break;
      if (seen.has(r.dto.name)) continue;
      seen.add(r.dto.name);
      picked.push(r.dto);
    }
    // 계절 후보가 목표 개수보다 적으면 인기 여행지로 채운다 (중복 제외).
    if (picked.length < DestinationsService.REC_LIMIT) {
      for (const d of this.popular(all)) {
        if (picked.length >= DestinationsService.REC_LIMIT) break;
        if (seen.has(d.name)) continue;
        seen.add(d.name);
        picked.push(d);
      }
    }
    return picked;
  }

  /**
   * 파서: 알려진 여행지(KTO 시도·시군구) 중 이번 달 추천 코퍼스에 언급된 것만 후보로 남긴다.
   * 블로그는 '경주시'가 아니라 '경주'로 쓰므로 행정 접미사를 뗀 어간으로 역방향 매칭하고,
   * 같은 어간이 여러 행정단위에 걸치면(시도 '부산' vs 시군구 '부산진구') 언급 많은 쪽만 남긴다.
   * 표시 이름도 어간(예: '강릉')으로 정리해 카드 제목·여행 생성 질의에 그대로 쓴다.
   */
  private parseSeasonalCandidates(
    all: DestinationSuggestionDto[],
    seasonal: PopularityIndex,
  ): SeasonalCandidate[] {
    const byName = new Map<string, SeasonalCandidate>();
    for (const d of all) {
      const label = regionSearchStem(d.name) || d.name;
      // 1글자 어간('시' 등 비정상)은 코퍼스 오탐이 심해 제외한다.
      if (label.length < 2) continue;
      const mentions = seasonal.mentions(label);
      if (mentions === 0) continue;

      const region = displayRegionName(d.region) ?? label;
      const candidate: SeasonalCandidate = {
        dto: { id: `seasonal-${d.id}`, name: label, region },
        key: prefKey(d.name),
        seasonalScore: seasonal.score(label),
      };
      const existing = byName.get(label);
      // 같은 표시 이름이면 언급 많은 쪽(시도 vs 시군구)을 대표로.
      if (!existing || mentions > seasonal.mentions(existing.dto.name)) {
        byName.set(label, candidate);
      }
    }
    return [...byName.values()];
  }

  /**
   * 취향 벡터로 시도·시군구 취향 점수를 조회해 어간 키 → 점수 맵으로 만든다.
   * 시군구·시도를 각각 어간 키로 등록(중복이면 최고 점수 유지)해 계절 후보와 대조한다.
   * 취향 벡터가 없으면 빈 맵(계절 언급 순 랭킹으로 폴백).
   */
  private async preferenceScoreMap(userId: string): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const vector = await this.preferences.getPreferenceVector(userId);
    if (!vector || vector.length === 0) return map;

    const ranked = await this.placeEmbeddings.recommendRegions(
      vector,
      DestinationsService.REC_TOP_K,
      DestinationsService.REC_MIN_PLACES,
      DestinationsService.REC_CANDIDATES,
    );
    const putMax = (rawKey: string | null, score: number) => {
      if (!rawKey) return;
      const key = prefKey(rawKey);
      if (!key) return;
      const prev = map.get(key);
      if (prev === undefined || score > prev) map.set(key, score);
    };
    for (const r of ranked) {
      putMax(displayRegionName(r.region), r.score);
      putMax(r.sigungu, r.score);
    }
    return map;
  }

  /**
   * 취향 벡터로 랭킹한 추천 여행지. 취향 벡터가 없거나(온보딩 전) 시딩된 지역이
   * 부족하면 인기 여행지로 폴백하고, 추천이 모자라면 인기순으로 채운다.
   * (네이버 계절 코퍼스를 쓸 수 없을 때의 폴백 경로.)
   */
  private async recommendByPreference(
    all: DestinationSuggestionDto[],
    userId: string,
  ): Promise<DestinationSuggestionDto[]> {
    const vector = await this.preferences.getPreferenceVector(userId);
    if (!vector || vector.length === 0) return this.popular(all);

    // 시도·시군구 후보를 넉넉히 받아서(전체 그룹 수가 많지 않음) 시도별로 대표 1개로 접는다.
    const ranked = await this.placeEmbeddings.recommendRegions(
      vector,
      DestinationsService.REC_TOP_K,
      DestinationsService.REC_MIN_PLACES,
      DestinationsService.REC_CANDIDATES,
    );
    if (ranked.length === 0) return this.popular(all);

    // 시도별 대표: 시군구 데이터가 있으면 그 시도의 최고 시/군/구, 없으면 시도 전체.
    // (밀도가 큰 '시도 전체' 버킷이 개별 시군구를 가리지 않도록 시군구를 우선한다.)
    const repBySido = new Map<string, RegionRecommendation>();
    for (const r of ranked) {
      const cur = repBySido.get(r.region);
      if (!cur || preferSigungu(cur, r)) repBySido.set(r.region, r);
    }
    const reps = [...repBySido.values()].sort((a, b) => b.score - a.score);

    const picked: DestinationSuggestionDto[] = [];
    const seen = new Set<string>();
    for (const r of reps) {
      if (picked.length >= DestinationsService.REC_LIMIT) break;
      const sido = displayRegionName(r.region);
      if (!sido) continue;
      // 시군구가 있으면 그 이름을 카드 제목으로(예: '경주시'), 상위 시도는 부제로 맥락 제공.
      const sigungu = r.sigungu?.trim() || null;
      const name = sigungu ?? sido;
      if (seen.has(name)) continue;
      seen.add(name);
      picked.push({
        id: `rec-${r.region}-${sigungu ?? ''}`,
        name,
        region: sido,
      });
    }
    // 추천이 목표 개수보다 적으면 인기 여행지로 채운다 (중복 제외).
    if (picked.length < DestinationsService.REC_LIMIT) {
      for (const d of this.popular(all)) {
        if (picked.length >= DestinationsService.REC_LIMIT) break;
        if (seen.has(d.name)) continue;
        seen.add(d.name);
        picked.push(d);
      }
    }
    return picked;
  }

  /** 빈 검색 시 인기 여행지를 우선 노출하고, 부족분은 앞에서부터 채운다. */
  private popular(all: DestinationSuggestionDto[]): DestinationSuggestionDto[] {
    const picked: DestinationSuggestionDto[] = [];
    const seen = new Set<string>();
    for (const token of POPULAR_NAMES) {
      const hit = all.find((d) => d.name.includes(token) && !seen.has(d.id));
      if (hit) {
        picked.push(hit);
        seen.add(hit.id);
      }
    }
    for (const d of all) {
      if (picked.length >= 8) break;
      if (!seen.has(d.id)) {
        picked.push(d);
        seen.add(d.id);
      }
    }
    return picked.slice(0, 8);
  }

  private getAll(): Promise<DestinationSuggestionDto[]> {
    if (!this.cache) {
      this.cache = this.load().catch((err) => {
        // 실패한 캐시는 버려 다음 요청에서 재시도할 수 있게 한다.
        this.cache = null;
        throw err;
      });
    }
    return this.cache;
  }

  private async load(): Promise<DestinationSuggestionDto[]> {
    const apiKey = this.config.get<string>('KTO_API_KEY', '');
    if (!apiKey) {
      this.logger.warn('KTO_API_KEY 미설정 — 여행 지역 목록을 비웁니다.');
      return [];
    }

    const sidos = await this.fetchAreas(apiKey);
    const list: DestinationSuggestionDto[] = [];

    for (const sido of sidos) {
      // 시도 자체도 후보로 포함
      list.push({
        id: `sido-${sido.code}`,
        name: sido.name,
        region: sido.name,
      });

      const sigungus = await this.fetchAreas(apiKey, String(sido.code));
      for (const sigungu of sigungus) {
        list.push({
          id: `${sido.code}-${sigungu.code}`,
          name: sigungu.name,
          region: sido.name,
        });
      }
    }

    this.logger.log(`관광공사 여행 지역 ${list.length}건 캐싱 완료`);
    return list;
  }

  /** lDongRegnCd 미지정 → 시도 목록, 지정 → 해당 시도의 시군구 목록 */
  private async fetchAreas(apiKey: string, lDongRegnCd?: string): Promise<AreaCodeItem[]> {
    const res = await axios.get<AreaCodeResponse>(this.BASE_URL, {
      params: {
        serviceKey: apiKey,
        numOfRows: 100,
        pageNo: 1,
        MobileOS: 'ETC',
        MobileApp: 'TriPick',
        _type: 'json',
        ...(lDongRegnCd ? { lDongRegnCd } : {}),
      },
    });
    return toItemArray(res.data.response);
  }
}
