import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { DestinationSuggestionDto } from '@tripick/types';
import {
  PlaceEmbeddingRepository,
  type RegionRecommendation,
} from '../planner/retrieval/place-embedding.repository';
import { regionStem } from '../planner/retrieval/place-seeds';
import { PreferencesService } from '../preferences/preferences.service';

/** place_embeddings 에 정규화 슬러그로 저장된 지역 → 표시용 한글명 */
const SLUG_TO_KO: Record<string, string> = {
  seoul: '서울',
  busan: '부산',
  jeju: '제주',
  gyeongju: '경주',
};

/** destination_region 원본값(시도명 or 슬러그) → 표시용 지역명. 'default' 등은 제외(null). */
function displayRegionName(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (!key || key === 'default') return null;
  if (SLUG_TO_KO[key]) return SLUG_TO_KO[key];
  // '부산광역시'→'부산', '제주특별자치도'→'제주', '경기도'→'경기'
  return regionStem(raw) || raw;
}

/** 같은 시도 내 두 후보 중 next 를 대표로 바꿔야 하는지. 시군구 있는 후보 우선, 같은 급이면 고점수. */
function preferSigungu(cur: RegionRecommendation, next: RegionRecommendation): boolean {
  const curHas = !!cur.sigungu?.trim();
  const nextHas = !!next.sigungu?.trim();
  if (curHas !== nextHas) return nextHas;
  return next.score > cur.score;
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

/** 시도 이름 → 대표 이모지. 매칭 없으면 📍. */
const SIDO_EMOJI: Array<[string, string]> = [
  ['서울', '🏙️'],
  ['부산', '🌊'],
  ['제주', '🌴'],
  ['인천', '🛫'],
  ['강원', '⛰️'],
  ['경기', '🏰'],
  ['경상북도', '🏛️'],
  ['경상남도', '⛵'],
  ['전북', '🥢'],
  ['전라북도', '🥢'],
  ['전라남도', '🌃'],
  ['충청', '🏞️'],
  ['충북', '🏞️'],
  ['충남', '🏞️'],
  ['대전', '🔬'],
  ['대구', '🍎'],
  ['광주', '🎨'],
  ['울산', '🏭'],
  ['세종', '🏢'],
];

function pickEmoji(sidoName: string): string {
  for (const [token, emoji] of SIDO_EMOJI) {
    if (sidoName.includes(token)) return emoji;
  }
  return '📍';
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

  constructor(
    private readonly config: ConfigService,
    private readonly preferences: PreferencesService,
    private readonly placeEmbeddings: PlaceEmbeddingRepository,
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
   * 취향 벡터로 랭킹한 추천 여행지. 취향 벡터가 없거나(온보딩 전) 시딩된 지역이
   * 부족하면 인기 여행지로 폴백하고, 추천이 모자라면 인기순으로 채운다.
   */
  async recommend(userId: string): Promise<DestinationSuggestionDto[]> {
    const all = await this.getAll();
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
        // 이모지는 원본 시도명으로 매칭해야 정확하다('경상북도'→🏛️).
        emoji: pickEmoji(r.region),
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
      const emoji = pickEmoji(sido.name);
      // 시도 자체도 후보로 포함
      list.push({
        id: `sido-${sido.code}`,
        name: sido.name,
        region: sido.name,
        emoji,
      });

      const sigungus = await this.fetchAreas(apiKey, String(sido.code));
      for (const sigungu of sigungus) {
        list.push({
          id: `${sido.code}-${sigungu.code}`,
          name: sigungu.name,
          region: sido.name,
          emoji,
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
