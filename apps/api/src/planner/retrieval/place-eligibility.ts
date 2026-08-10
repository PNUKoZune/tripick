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

/**
 * 서비스 범위 밖 카테고리. 숙박은 방문 일정 후보가 아니다 — v1 은 숙소를 일정 모델에 두지 않고
 * `PlannerService.toItemType` 이 accommodation 을 'attraction' 으로 접으므로, 호텔이 후보로
 * 들어오면 **'관광지'로 표시되는 일정 항목**이 된다.
 *
 * 적재 경로는 이미 막혀 있다(KTO contentTypeId 32 제외, 카카오 적재는 AD5 를 검색하지 않음,
 * popular 은 축 카테고리 화이트리스트). 남은 구멍은 **검색 런타임 카카오 폴백**이다 —
 * `KakaoLocalService.search` 는 category_group_code 제한 없이 키워드로 훑어서
 * ('속초 관광지' → 'OO관광호텔') AD5 문서를 후보로 올린다. 규칙 이전에 적재된 행도 여기서 막힌다.
 */
const EXCLUDED_CATEGORIES = new Set(['accommodation']);

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
 * 국내 좌표 타당 범위. 남단 마라도(33.06)·북단 고성(38.6)·서단 백령도(124.6)·동단 독도(131.9)에
 * 여유를 둔 값이다.
 *
 * 왜 필요한가 — KTO 가 일부 항목에 **placeholder 좌표를 준다.** 카탈로그 실측에서 서울 계남근린공원·
 * 관악구민운동장·세종 미술주간 3행이 전부 `{lat: 19.694, lng: 117.993}`(남중국해)로 들어와 있었다.
 * 적재 게이트가 non-finite 와 (0,0)만 막고 있어 통과했다. 이런 후보는 지도 마커가 바다에 찍히고
 * `RouteHelper` 이동시간이 수천 km 로 계산돼 동선이 통째로 망가진다.
 */
const KOREA_BOUNDS = { minLat: 32.9, maxLat: 38.8, minLng: 124.4, maxLng: 132.1 };

export function isPlausibleKoreanCoordinate(coordinates: { lat: number; lng: number }): boolean {
  const { lat, lng } = coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat >= KOREA_BOUNDS.minLat &&
    lat <= KOREA_BOUNDS.maxLat &&
    lng >= KOREA_BOUNDS.minLng &&
    lng <= KOREA_BOUNDS.maxLng
  );
}

/**
 * 자동 일정에 부적합한 장소(의료 시설·행정구역명·좌표 불량)가 유입되는 것을 막는다.
 *
 * 좌표 검사가 **점수 항이 아니라 여기 있는 이유** — 예전엔 `dataQuality` 항이 좌표·주소 유무로
 * 가점하며 방어하는 척했지만, `PlaceDto` 가 그 필드들을 필수로 두고 있어 검사가 타입상 도달
 * 불가였고 실효 차이도 총점 0.004 였다. 좌표가 깨진 후보는 "순위를 조금 낮출" 대상이 아니라
 * 후보에서 빠져야 하는 대상이다.
 */
export function isEligibleItineraryCandidate(
  place: Pick<RawPlaceCandidate, 'name' | 'category'> & {
    categoryDetail?: string;
    coordinates?: { lat: number; lng: number };
  },
): boolean {
  if (place.coordinates && !isPlausibleKoreanCoordinate(place.coordinates)) return false;

  if (EXCLUDED_CATEGORIES.has(place.category)) return false;

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
