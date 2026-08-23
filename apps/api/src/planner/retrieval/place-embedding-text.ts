import { inferPlaceTags } from './place-seeds';
import { placeRegionCodes } from './region-code';
import type { IngestPlace } from './ingestion.types';

/**
 * 임베딩 대상 텍스트를 구성한다. 카테고리 상세(카카오 경로/KTO 유형명)와 지역(시도·시군구)을
 * 명시적으로 포함해 질의(destination:… taste:…)와 토큰이 겹치도록 하고 의미 신호를 강화한다.
 *
 * 지역은 수집 라벨이 아니라 **정본 코드**를 쓴다. 라벨은 그 행을 어떤 타깃으로 수집했는지에
 * 따라 달라져서('속초' vs '강원특별자치도'), 같은 장소가 실행마다 다른 텍스트 해시를 갖고
 * 매번 재임베딩됐다(증분 적재가 무력화되고 라벨이 뒤집힌다). 코드는 주소에서 파생되므로
 * 어느 타깃으로 수집해도 같다 — 해시가 안정되고 unchanged 로 떨어진다.
 *
 * 적재 파이프라인 밖(카테고리 backfill CLI)에서도 같은 텍스트를 만들어야 해서 서비스 메서드가
 * 아니라 순수 함수다. 두 곳이 갈리면 backfill 이 쓴 해시가 다음 적재에서 곧바로 어긋나
 * 같은 행을 매번 다시 임베딩한다.
 */
export function buildPlaceEmbeddingText(place: IngestPlace): string {
  const tags = inferPlaceTags(place).join(', ');
  const { regionCode, sigunguCode } = placeRegionCodes(
    place.region,
    place.sigungu ?? null,
    place.address,
  );
  const regionLabel = [regionCode, sigunguCode].filter(Boolean).join(' ');
  return [
    place.name,
    place.categoryDetail || place.category,
    regionLabel ? `지역: ${regionLabel}` : '',
    place.address,
    tags ? `태그: ${tags}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}
