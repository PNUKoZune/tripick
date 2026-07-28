import { isSeoBusinessName } from './place-name-quality';
import { isRegionLabel } from './region-code';
import type { RawPlaceCandidate } from './types';

const EXCLUDED_CATEGORY_KEYWORDS = [
  '의료,건강',
  '병원',
  '의원',
  '한의원',
  '약국',
  '보건소',
  '치과',
  '클리닉',
];

const TRAVEL_CATEGORY_KEYWORDS = [
  '여행',
  '관광',
  '문화시설',
  '공원',
  '레포츠',
  '음식점',
  '카페',
  '쇼핑',
];

/**
 * 자동 일정에 부적합한 장소(의료 시설·행정구역명)가 attraction 기본값으로 유입되는 것을 막는다.
 */
export function isEligibleItineraryCandidate(
  place: Pick<RawPlaceCandidate, 'name' | 'category'> & { categoryDetail?: string },
): boolean {
  // 행정구역명 자체는 방문할 장소가 아니다. 카카오에 '제주도'·'경상북도' 같은 이름으로 등록된
  // 문서가 있고, 인지도 매칭에서 코퍼스 언급을 통째로 흡수해 상위를 차지한다
  // (실측: 제주 케이스 1위가 '제주도', 인지도 1.00). 여행 카테고리를 달고 오므로
  // 아래 카테고리 화이트리스트로는 걸러지지 않아 이름으로 막는다.
  if (isRegionLabel(place.name)) return false;

  // 검색 노출용 문구를 상호로 등록한 SEO 상호('경주맛집'). 적재에서도 막지만, 규칙이 생기기
  // 전에 들어온 행과 아직 정리 스크립트를 돌리지 않은 환경이 있어 검색 단계에서도 뺀다.
  // 카테고리 화이트리스트는 이걸 못 막는다 — 실존 음식점이라 '음식점' 카테고리를 달고 온다.
  if (isSeoBusinessName(place.name)) return false;

  const categoryDetail = normalize(place.categoryDetail ?? '');
  if (EXCLUDED_CATEGORY_KEYWORDS.some((keyword) => categoryDetail.includes(normalize(keyword)))) {
    return false;
  }

  // 카카오/KTO가 명시적으로 여행·식음 카테고리를 준 경우 장소명의 단어보다 이를 우선한다.
  if (TRAVEL_CATEGORY_KEYWORDS.some((keyword) => categoryDetail.includes(normalize(keyword)))) {
    return true;
  }
  if (place.category === 'restaurant' || place.category === 'cafe') return true;

  const name = normalize(place.name);
  return !EXCLUDED_CATEGORY_KEYWORDS.some((keyword) => name.includes(normalize(keyword)));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}
