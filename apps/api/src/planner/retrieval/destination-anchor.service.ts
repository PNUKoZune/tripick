import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KakaoLocalService, type KakaoPlaceBrief } from './kakao-local.service';
import { PlaceEmbeddingRepository } from './place-embedding.repository';
import { destinationRegionFilter, placeRegionCodes } from './region-code';
import type { DestinationAnchor } from './types';

/**
 * 앵커로 삼으면 안 되는 카카오 category_group_code — **그 자체가 목적지가 아닌 부속 시설**.
 *
 * 실측에서 '광안리' 상위 3건이 해수욕장·공영주차장(PK6)·호텔(AD5)이었다. 주차장 좌표는
 * 해수욕장과 200m 차이라 결과가 크게 다르진 않지만, 앵커 라벨이 '광안리해수욕장 공영주차장'
 * 이 되면 로그로 무슨 일이 일어났는지 읽을 수 없다.
 *
 * **지하철역(SW8)은 빼지 않는다** — '서면역'·'광안역' 처럼 역세권으로 목적지를 말하는 게
 * 이 기능의 원래 요청이다. 대학(SC4)도 마찬가지('홍대'·'건대').
 */
const NON_ANCHOR_CATEGORIES: ReadonlySet<string> = new Set([
  'PK6', // 주차장
  'AD5', // 숙박
  'OL7', // 주유소·충전소
  'BK9', // 은행
  'HP8', // 병원
  'PM9', // 약국
  'AG2', // 중개업소
  'CS2', // 편의점
  'MT1', // 대형마트
]);

/** 동점일 때 앞세우는 앵커 카테고리 (지역을 대표하는 지점). */
const PREFERRED_ANCHOR_CATEGORIES: ReadonlySet<string> = new Set([
  'AT4', // 관광명소
  'CT1', // 문화시설
  'SW8', // 지하철역
]);

/** 앵커 후보를 몇 건까지 훑을지. 상위 몇 건 안에 없으면 애초에 그 이름의 대표 지점이 아니다. */
const ANCHOR_CANDIDATE_LIMIT = 5;

/** 기본 캐시 수명 (6시간). 지명→좌표는 거의 안 변하므로 네이버 코퍼스와 같은 주기로 둔다. */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/** 공백 제거 + 소문자화. 이름 포함 판정을 표기 흔들림에 견디게 한다. */
function compact(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase();
}

/**
 * 목적지 문자열을 좌표 앵커로 해석한다.
 *
 * ## 언제 도는가
 *
 * **행정구역으로 안 잡히는 목적지에만** 돈다. 시도가 잡히면('부산', '부산 해운대구') 그대로
 * 두고, 시군구 코드가 카탈로그에 실재하면('해운대' 61행, '경주' 382행) 역시 그대로 둔다.
 * 즉 지금까지 잘 되던 목적지의 동작은 한 글자도 안 바뀌고, **후보가 0건이던 입력만** 이 경로로
 * 온다(실측: '광안리'·'서면'·'성수동'·'홍대' 가 sigungu_code 0행).
 *
 * ## 이름이 안 맞으면 앵커를 포기한다
 *
 * 카카오 키워드 검색은 상호명이 아니라 **행정 지명**과도 맞아서, 광역 별칭은 엉뚱한 곳을 준다:
 *
 * ```
 * '광안리' → 광안리해수욕장 | 부산 수영구 광안동      ✅
 * '서면'   → 순천자연휴양림  | 전남 순천시 서면 운평리  ❌ (부산 서면이 아님)
 * ```
 *
 * '서면'은 부산진구 별칭이자 전국 여러 시군의 행정 면(面)이라 질의만으로는 못 가른다.
 * 그래서 **후보 장소명이 목적지 문자열을 포함할 때만** 앵커로 채택하고, 아니면 null 을 돌려
 * 기존 경로로 되돌린다 — 틀린 앵커는 아무 앵커도 없는 것보다 나쁘다(전남 여행이 되어 버린다).
 *
 * 이 규칙은 '성수동'(→서울숲카페거리)·'홍대'(→홍익대학교) 처럼 대표 지점 이름이 지명과 다른
 * 경우도 함께 거절한다. 그건 휴리스틱으로 풀 문제가 아니라 **사용자가 후보를 고르게 하는
 * 문제**다 — 목적지 입력에 카카오 후보를 띄워 좌표째 받는 후속 작업에서 없어진다.
 */
@Injectable()
export class DestinationAnchorService {
  private readonly logger = new Logger(DestinationAnchorService.name);
  /** 목적지별 해석 결과. **실패(null)도 캐시한다** — 일자별 지역까지 겹치면 같은 실패를 반복 조회한다. */
  private readonly cache = new Map<string, { anchor: DestinationAnchor | null; expires: number }>();
  private readonly inFlight = new Map<string, Promise<DestinationAnchor | null>>();

  constructor(
    private readonly config: ConfigService,
    private readonly kakaoLocal: KakaoLocalService,
    private readonly placeEmbeddings: PlaceEmbeddingRepository,
  ) {}

  async resolve(destination: string): Promise<DestinationAnchor | null> {
    if (!this.enabled()) return null;
    const key = compact(destination);
    if (!key) return null;

    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.anchor;

    const running = this.inFlight.get(key);
    if (running) return running;

    const pending = this.resolveUncached(destination).then((anchor) => {
      this.cache.set(key, { anchor, expires: Date.now() + this.ttlMs() });
      return anchor;
    });
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    }
  }

  private async resolveUncached(destination: string): Promise<DestinationAnchor | null> {
    if (!(await this.needsAnchor(destination))) return null;

    const docs = await this.kakaoLocal.searchBrief(destination, ANCHOR_CANDIDATE_LIMIT);
    const doc = this.pickAnchor(destination, docs);
    if (!doc) {
      this.logger.log(
        `목적지 "${destination}" 앵커 해석 실패 (후보 ${docs.length}건 중 이름이 맞는 게 없음) — 기존 지역 검색으로 진행합니다.`,
      );
      return null;
    }

    // 지역 코드는 **지번 주소**에서 뽑는다. 적재 쪽 정본과 같은 함수라 코드 체계가 갈리지 않는다.
    const { regionCode, sigunguCode } = placeRegionCodes(null, null, doc.address);
    if (!regionCode && !sigunguCode) {
      this.logger.warn(
        `목적지 "${destination}" 앵커 주소에서 지역 코드를 못 뽑았습니다 (address="${doc.address}") — 폴백 범위가 없어 앵커를 쓰지 않습니다.`,
      );
      return null;
    }

    this.logger.log(
      `목적지 "${destination}" → 앵커 "${doc.name}" (${doc.address}) region=${regionCode ?? sigunguCode}`,
    );
    return {
      coordinates: doc.coordinates,
      label: doc.name,
      region: { sido: regionCode, sigungu: sigunguCode },
    };
  }

  /**
   * 이 목적지가 앵커를 필요로 하는지. 순서가 곧 "기존 동작을 안 건드린다"는 보장이다.
   * 시도가 잡히면 시도 전역이 정책이고(§destinationRegionFilter), 시군구 코드로 실제 후보가
   * 나오면 그것도 이미 지역 단위로 잘 도는 목적지다.
   */
  private async needsAnchor(destination: string): Promise<boolean> {
    const { sido, sigungu } = destinationRegionFilter(destination);
    if (sido) return false;
    if (!sigungu) return false;
    return (await this.placeEmbeddings.countRegionCandidates(destination)) === 0;
  }

  /**
   * 앵커 후보 중 하나를 고른다. 부속 시설을 걷어내고, **이름이 목적지를 포함하는** 후보만
   * 남긴 뒤 대표 카테고리를 앞세운다. 동점이면 카카오 정확도 순서를 그대로 따른다.
   */
  private pickAnchor(destination: string, docs: KakaoPlaceBrief[]): KakaoPlaceBrief | null {
    const needle = compact(destination);
    // 한 글자 목적지는 포함 판정이 우연히 맞기 쉬워 아예 시도하지 않는다.
    if (needle.length < 2) return null;

    let best: { doc: KakaoPlaceBrief; score: number } | null = null;
    for (const doc of docs) {
      if (doc.categoryGroupCode && NON_ANCHOR_CATEGORIES.has(doc.categoryGroupCode)) continue;
      if (!compact(doc.name).includes(needle)) continue;
      const score = PREFERRED_ANCHOR_CATEGORIES.has(doc.categoryGroupCode ?? '') ? 1 : 0;
      if (!best || score > best.score) best = { doc, score };
    }
    return best?.doc ?? null;
  }

  private enabled(): boolean {
    return this.config.get<string>('DESTINATION_ANCHOR_ENABLED', 'true') !== 'false';
  }

  private ttlMs(): number {
    const value = Number(
      this.config.get<string | number>('DESTINATION_ANCHOR_TTL_MS', DEFAULT_TTL_MS),
    );
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_TTL_MS;
  }
}
