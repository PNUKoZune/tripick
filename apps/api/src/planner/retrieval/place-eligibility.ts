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

/** 자동 일정에 부적합한 의료 장소가 attraction 기본값으로 유입되는 것을 막는다. */
export function isEligibleItineraryCandidate(
  place: Pick<RawPlaceCandidate, 'name' | 'category'> & { categoryDetail?: string },
): boolean {
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
