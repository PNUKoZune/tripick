import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { DestinationSuggestionDto } from '@tripick/types';

/** areaCode2 응답 아이템 (시도 / 시군구 공통) */
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
 * 한국관광공사 국문관광정보 서비스(GW)의 areaCode2를 이용해
 * 시도 + 시군구 여행 지역 목록을 구성한다.
 * 지역 목록은 거의 변하지 않으므로 최초 1회 조회 후 메모리에 캐싱한다.
 */
@Injectable()
export class DestinationsService {
  private readonly logger = new Logger(DestinationsService.name);
  private readonly BASE_URL = 'https://apis.data.go.kr/B551011/KorService2/areaCode2';
  private cache: Promise<DestinationSuggestionDto[]> | null = null;

  constructor(private readonly config: ConfigService) {}

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

  /** areaCode 미지정 → 시도 목록, 지정 → 해당 시도의 시군구 목록 */
  private async fetchAreas(apiKey: string, areaCode?: string): Promise<AreaCodeItem[]> {
    const res = await axios.get<AreaCodeResponse>(this.BASE_URL, {
      params: {
        serviceKey: apiKey,
        numOfRows: 100,
        pageNo: 1,
        MobileOS: 'ETC',
        MobileApp: 'TriPick',
        _type: 'json',
        ...(areaCode ? { areaCode } : {}),
      },
    });
    return toItemArray(res.data.response);
  }
}
