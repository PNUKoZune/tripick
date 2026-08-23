import { Injectable, Logger } from '@nestjs/common';
import { KakaoLocalService } from './kakao-local.service';
import { isEligibleItineraryCandidate } from './place-eligibility';
import { parseSigungu } from './place-seeds';
import { placeRegionCodes, sidoCodesForLabel } from './region-code';
import type { SidoCode } from './region-code';
import type { IngestPlace } from './ingestion.types';
import type { RawPlaceCandidate } from './types';

/**
 * 운영자가 이름을 직접 지정해 적재하는 소스.
 *
 * 왜 필요한가 — 자동 소스 셋 다 **구조적으로 못 닿는 장소**가 있다.
 *   - `tour`    KTO 에 등록돼 있지 않으면 존재하지 않는다
 *   - `kakao`   카테고리 검색이라 `category_group_code` 가 빈 문서는 영원히 안 나온다
 *               (실측: '자만벽화마을'). 반경을 좁혀도 한 질의 45건 상한에 걸린다
 *   - `popular` 네이버 추천 글에 이름이 자주 올라야 잡힌다. 서브지역 어간이 코퍼스를 못 만들면
 *               통째로 빈다 (실측: 목적지 '서면' 코퍼스에서 수집 1건, '전리단길' 미포함)
 *
 * 그래서 "그 장소가 있는 걸 아는데 어떤 자동 경로도 안 데려온다"는 상태가 남는다. 이 소스가
 * 그 탈출구다 — 이름을 주면 카카오 키워드 검색으로 정본(이름·좌표·주소)을 받아 적재한다.
 *
 * 정확성은 두 관문이 지킨다. 사람이 지정했다고 무검증으로 넣지 않는다:
 *   ① **주소 기준 지역 검증** — 카카오 키워드 검색은 지역 접두어를 붙여도 타지역 동명 장소를
 *      섞어 준다('사직공원'→서울). 목적지 시도와 주소 시도가 어긋나면 버린다
 *   ② **일정 후보 적격 게이트** — 다른 소스와 같은 `isEligibleItineraryCandidate`.
 *      운영자 실수로 병원·숙박·프랜차이즈 지점이 들어오는 걸 막는다
 */
@Injectable()
export class KeywordPlaceService {
  private readonly logger = new Logger(KeywordPlaceService.name);

  /** 키워드 1건당 볼 카카오 문서 수. 1위가 타지역 동명일 수 있어 여러 개를 본다. */
  private static readonly DOCS_PER_KEYWORD = 5;

  constructor(private readonly kakaoLocal: KakaoLocalService) {}

  /**
   * 키워드 목록을 카카오로 정규화해 적재 후보로 만든다.
   * 지역 검증을 통과한 **첫 문서**만 취한다 — 한 키워드는 한 장소를 가리킨다는 전제다.
   */
  async collect(region: string, keywords: readonly string[]): Promise<IngestPlace[]> {
    const targetSidos = this.targetSidos(region);
    const collected: IngestPlace[] = [];
    const seen = new Set<string>();
    const rejected: string[] = [];

    for (const keyword of keywords) {
      const query = keyword.trim();
      if (!query) continue;

      const docs = await this.kakaoLocal.searchByText(
        query,
        KeywordPlaceService.DOCS_PER_KEYWORD,
      );
      const picked = docs.find((doc) => this.accepts(doc, region, targetSidos, seen));
      if (!picked) {
        rejected.push(query);
        continue;
      }
      if (picked.kakaoPlaceId) seen.add(picked.kakaoPlaceId);
      collected.push(this.toIngestPlace(picked, region));
    }

    this.logger.log(
      `[${region}] 키워드 ${keywords.length}개 → 확정 ${collected.length}건` +
        (rejected.length > 0 ? ` (미해결 ${rejected.length}: ${rejected.join(', ')})` : ''),
    );
    return collected;
  }

  /**
   * 목적지 라벨이 가리키는 시도 코드. 시군구 라벨('서면'·'광안리')은 시도로 안 잡히므로
   * 검증을 건너뛴다 — 이 소스는 이름을 사람이 지정하므로 `popular` 처럼 상위 시도를 되짚는
   * 추가 조회까지 할 이유가 없다.
   */
  private targetSidos(region: string): SidoCode[] {
    const sidos = sidoCodesForLabel(region);
    if (sidos.length === 0) {
      this.logger.warn(
        `[${region}] 시도 코드로 안 잡히는 라벨 — 지역 검증 없이 수집합니다(타지역 동명 장소 주의).`,
      );
    }
    return sidos;
  }

  private accepts(
    doc: RawPlaceCandidate,
    region: string,
    targetSidos: SidoCode[],
    seen: Set<string>,
  ): boolean {
    if (doc.kakaoPlaceId && seen.has(doc.kakaoPlaceId)) return false;
    if (!isEligibleItineraryCandidate(doc)) return false;
    if (targetSidos.length === 0) return true;

    // 주소가 정본 — 키워드에 지역을 붙여도 카카오는 타지역 동명 장소를 섞어 준다.
    const { regionCode } = placeRegionCodes(region, null, doc.address);
    return regionCode !== null && targetSidos.includes(regionCode);
  }

  private toIngestPlace(doc: RawPlaceCandidate, region: string): IngestPlace {
    const sigungu = parseSigungu(doc.address);
    return {
      ...(doc.kakaoPlaceId ? { kakaoPlaceId: doc.kakaoPlaceId } : {}),
      name: doc.name,
      category: doc.category,
      ...(doc.categoryDetail ? { categoryDetail: doc.categoryDetail } : {}),
      address: doc.address,
      coordinates: doc.coordinates,
      region,
      ...(sigungu ? { sigungu } : {}),
      source: 'keyword',
    };
  }
}
