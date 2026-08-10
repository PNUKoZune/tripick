import type { PlaceDto, TasteTagDto } from '@tripick/types';
import type { RawPlaceCandidate } from './types';

export interface SeedPlace extends PlaceDto {
  tags: string[];
}

const SEOUL_SEEDS: SeedPlace[] = [
  { id: 'seoul-1', name: '성수 서울숲', category: 'park', address: '서울 성동구 뚝섬로 273', coordinates: { lat: 37.5446, lng: 127.0375 }, openingHours: '08:00-21:00', tags: ['nature', 'healing', 'walk'] },
  { id: 'seoul-2', name: '성수 감도 카페', category: 'cafe', address: '서울 성동구 연무장길 45', coordinates: { lat: 37.5441, lng: 127.0541 }, openingHours: '10:00-22:00', tags: ['cafe', 'city', 'healing'] },
  { id: 'seoul-3', name: '을지로 한식 다이닝', category: 'restaurant', address: '서울 중구 수표로 48', coordinates: { lat: 37.5667, lng: 126.9913 }, openingHours: '11:00-21:00', tags: ['korean', 'cultural', 'city'] },
  { id: 'seoul-4', name: '국립중앙박물관', category: 'attraction', address: '서울 용산구 서빙고로 137', coordinates: { lat: 37.523, lng: 126.9804 }, openingHours: '10:00-18:00', tags: ['cultural', 'family', 'city'] },
  { id: 'seoul-5', name: '한강 노들섬', category: 'attraction', address: '서울 용산구 양녕로 445', coordinates: { lat: 37.5177, lng: 126.9574 }, openingHours: '09:00-22:00', tags: ['nature', 'romantic', 'city'] },
  { id: 'seoul-6', name: '북촌 골목 산책', category: 'attraction', address: '서울 종로구 계동길 37', coordinates: { lat: 37.5826, lng: 126.9831 }, openingHours: '09:00-18:00', tags: ['cultural', 'village', 'walk'] },
];

const BUSAN_SEEDS: SeedPlace[] = [
  { id: 'busan-1', name: '해운대 블루라인파크', category: 'attraction', address: '부산 해운대구 청사포로 116', coordinates: { lat: 35.1587, lng: 129.1758 }, openingHours: '09:00-19:00', tags: ['beach', 'adventure', 'nature'] },
  { id: 'busan-2', name: '광안리 브런치 카페', category: 'cafe', address: '부산 수영구 광안해변로 219', coordinates: { lat: 35.1532, lng: 129.1185 }, openingHours: '10:00-22:00', tags: ['cafe', 'beach', 'romantic'] },
  { id: 'busan-3', name: '기장 해산물 식당', category: 'restaurant', address: '부산 기장군 기장해안로 266', coordinates: { lat: 35.1906, lng: 129.2231 }, openingHours: '11:00-21:00', tags: ['korean', 'family', 'beach'] },
  { id: 'busan-4', name: '흰여울문화마을', category: 'attraction', address: '부산 영도구 영선동4가 605-3', coordinates: { lat: 35.078, lng: 129.0455 }, openingHours: '09:00-18:00', tags: ['village', 'healing', 'nature'] },
  { id: 'busan-5', name: '부산현대미술관', category: 'attraction', address: '부산 사하구 낙동남로 1191', coordinates: { lat: 35.1049, lng: 128.9668 }, openingHours: '10:00-18:00', tags: ['cultural', 'city', 'family'] },
  { id: 'busan-6', name: '송정 해변 산책', category: 'attraction', address: '부산 해운대구 송정해변로 50', coordinates: { lat: 35.1804, lng: 129.1998 }, openingHours: '08:00-21:00', tags: ['beach', 'healing', 'walk'] },
];

const JEJU_SEEDS: SeedPlace[] = [
  { id: 'jeju-1', name: '사려니숲길', category: 'attraction', address: '제주 제주시 조천읍 교래리 산137-1', coordinates: { lat: 33.4221, lng: 126.6426 }, openingHours: '09:00-17:00', tags: ['nature', 'healing', 'mountain'] },
  { id: 'jeju-2', name: '애월 오션뷰 카페', category: 'cafe', address: '제주 제주시 애월읍 애월북서길 56', coordinates: { lat: 33.4634, lng: 126.3098 }, openingHours: '10:00-21:00', tags: ['cafe', 'beach', 'romantic'] },
  { id: 'jeju-3', name: '제주 흑돼지 식당', category: 'restaurant', address: '제주 제주시 원노형로 41', coordinates: { lat: 33.4872, lng: 126.4815 }, openingHours: '11:00-22:00', tags: ['korean', 'family', 'city'] },
  { id: 'jeju-4', name: '성산일출봉', category: 'attraction', address: '제주 서귀포시 성산읍 일출로 284-12', coordinates: { lat: 33.4589, lng: 126.9425 }, openingHours: '07:00-20:00', tags: ['adventure', 'nature', 'mountain'] },
  { id: 'jeju-5', name: '제주 민속촌', category: 'attraction', address: '제주 서귀포시 표선면 민속해안로 631-34', coordinates: { lat: 33.3225, lng: 126.8425 }, openingHours: '09:00-18:00', tags: ['cultural', 'village', 'family'] },
  { id: 'jeju-6', name: '협재 해변 산책', category: 'attraction', address: '제주 제주시 한림읍 협재리 2497-1', coordinates: { lat: 33.3945, lng: 126.2395 }, openingHours: '08:00-21:00', tags: ['beach', 'healing', 'walk'] },
];

const GYEONGJU_SEEDS: SeedPlace[] = [
  { id: 'gyeongju-1', name: '첨성대 야경 산책', category: 'attraction', address: '경북 경주시 인왕동 839-1', coordinates: { lat: 35.8347, lng: 129.2187 }, openingHours: '09:00-22:00', tags: ['cultural', 'romantic', 'walk'] },
  { id: 'gyeongju-2', name: '황리단길 한옥 카페', category: 'cafe', address: '경북 경주시 포석로 1080', coordinates: { lat: 35.8389, lng: 129.2107 }, openingHours: '10:00-22:00', tags: ['cafe', 'village', 'romantic'] },
  { id: 'gyeongju-3', name: '교리김밥 본점', category: 'restaurant', address: '경북 경주시 탑리3길 2', coordinates: { lat: 35.8429, lng: 129.2136 }, openingHours: '08:30-17:30', tags: ['korean', 'family', 'local'] },
  { id: 'gyeongju-4', name: '불국사', category: 'attraction', address: '경북 경주시 불국로 385', coordinates: { lat: 35.7901, lng: 129.3321 }, openingHours: '09:00-18:00', tags: ['cultural', 'family', 'nature'] },
  { id: 'gyeongju-5', name: '동궁과 월지', category: 'attraction', address: '경북 경주시 원화로 102', coordinates: { lat: 35.8349, lng: 129.2267 }, openingHours: '09:00-22:00', tags: ['cultural', 'romantic', 'city'] },
  { id: 'gyeongju-6', name: '보문호 산책로', category: 'attraction', address: '경북 경주시 보문로 424-33', coordinates: { lat: 35.8526, lng: 129.2828 }, openingHours: '08:00-22:00', tags: ['nature', 'healing', 'walk'] },
];

const DEFAULT_SEEDS: SeedPlace[] = [
  { id: 'default-1', name: '로컬 대표 전망 스팟', category: 'attraction', address: '도심 중심 관광지', coordinates: { lat: 37.5665, lng: 126.978 }, openingHours: '09:00-20:00', tags: ['city', 'healing'] },
  { id: 'default-2', name: '로컬 브런치 카페', category: 'cafe', address: '메인 스트리트 12', coordinates: { lat: 37.5659, lng: 126.9827 }, openingHours: '10:00-21:00', tags: ['cafe', 'city'] },
  { id: 'default-3', name: '로컬 시그니처 식당', category: 'restaurant', address: '맛집 골목 7', coordinates: { lat: 37.5644, lng: 126.977 }, openingHours: '11:00-21:00', tags: ['korean', 'family'] },
  { id: 'default-4', name: '로컬 문화 공간', category: 'attraction', address: '문화광장 2', coordinates: { lat: 37.5701, lng: 126.9769 }, openingHours: '10:00-18:00', tags: ['cultural', 'city'] },
  { id: 'default-5', name: '강변 산책 코스', category: 'attraction', address: '강변 산책로', coordinates: { lat: 37.5722, lng: 126.9911 }, openingHours: '08:00-22:00', tags: ['nature', 'walk'] },
  { id: 'default-6', name: '야간 디저트 바', category: 'restaurant', address: '야간상권 19', coordinates: { lat: 37.5692, lng: 126.9855 }, openingHours: '17:00-23:00', tags: ['romantic', 'city', 'cafe'] },
];

const SEEDS_BY_REGION: Record<string, SeedPlace[]> = {
  seoul: SEOUL_SEEDS,
  busan: BUSAN_SEEDS,
  jeju: JEJU_SEEDS,
  gyeongju: GYEONGJU_SEEDS,
  default: DEFAULT_SEEDS,
};

/**
 * 장소 이름·카테고리·주소에서 취향 태그를 유추하는 키워드 사전.
 *
 * 여기서 나오는 태그가 사용자 취향 태그(FOOD/MOOD/ENVIRONMENT_PREFERENCES)와 같은 어휘여야
 * 개인화 검색이 성립한다. 취향 어휘에 값을 추가하면 여기에도 대응 키워드를 넣어야
 * 그 태그가 붙는 장소가 생긴다.
 */
/**
 * 이름이 '…산' 으로 끝나는 시·군. 이 두 글자는 산이 아니라 행정지명이다.
 *
 * 실측(카탈로그 10,481행)에서 오탐 34건이 전부 여기서 나왔다 — 'CGV 논산'·'군산 해망굴'·
 * '개심사(서산)'·'금산 칠백의총' 처럼 지역명을 앞에 붙인 KTO 등록명이 통째로 산악 취향으로
 * 잡혔다. 예전 규칙은 부산·울산·마산·경산 넉 자만 막아 나머지 열 곳이 새고 있었다.
 */
const REGION_NAMES_ENDING_IN_SAN = [
  '부산', '울산', '안산', '오산', '아산', '서산',
  '논산', '예산', '금산', '군산', '익산', '양산', '마산', '경산',
] as const;

/**
 * '…산' 뒤에 붙어도 산악 신호가 유지되는 시설·구역어.
 *
 * "뒤에 한글이 오면 무조건 제외" 하던 예전 규칙이 '한라산국립공원'·'팔공산케이블카'·
 * '가야산국립공원' 같은 **가장 대표적인 산악 후보 46건**을 놓치고 있었다. 반대로 목록에 없는
 * 뒷말은 계속 막아야 한다 — '해산물'·'수산시장'·'부산진구' 가 그 예다.
 * '온천' 은 넣지 않는다 — '덕산온천로'·'탄산온천' 처럼 주소·상호에서 오탐이 더 많고,
 * 온천 자체는 hotspring 힌트가 이미 잡는다.
 */
const MOUNTAIN_FACILITY_WORDS = [
  '국립공원', '도립공원', '군립공원', '자연공원', '자연휴양림', '휴양림',
  '케이블카', '둘레길', '등산로', '탐방로', '전망대', '소공원', '생태공원',
  '천문대', '스키장', '승마장', '정상',
] as const;

/**
 * 지명형 '산'(한라산·북한산·금오산) 판정.
 *
 * 세 조건을 동시에 본다.
 *   ① `(?<=[가-힣])` — 산 앞이 한글. '산책로'·'산업단지'처럼 어절 첫 글자인 '산'을 뺀다.
 *   ② 행정지명 배제 — 어절 첫 글자 + '산' 이면 `REGION_NAMES_ENDING_IN_SAN` 로 본다.
 *      **앞이 한글이면 배제하지 않는 게 핵심** — '금오산'의 '오'를 오산으로 오인해 실제 산을
 *      떨어뜨리면 안 된다. 방위·신구 접두는 지역명 쪽이라 허용한다('동부산'·'서울산').
 *   ③ 뒤가 한글이 아니거나 `MOUNTAIN_FACILITY_WORDS` 로 이어질 때만 인정.
 */
const REGION_FIRST_LETTERS = REGION_NAMES_ENDING_IN_SAN.map((name) => name[0]).join('');
const MOUNTAIN_NAME_PATTERN = new RegExp(
  `(?<=[가-힣])(?<!(?<![가-힣])[동서남북신구]?[${REGION_FIRST_LETTERS}])` +
    `산(?:(?![가-힣])|(?=${MOUNTAIN_FACILITY_WORDS.join('|')}))`,
  'u',
);

/**
 * 임야 지번(`… 산 182`·`… 산83-31`). 지목이 임야라는 뜻이라 그 자리가 산·숲이다.
 *
 * 예전 `산` 정규식이 **의도치 않게** 잡던 신호인데(공백 뒤 '산'도 통과했다) 버리면 안 된다 —
 * 실측 200건 중 198건이 백록담·사라오름·금정산성처럼 이름에 '산'이 없는 실제 산악 후보였고,
 * 음식점·카페는 2건뿐(둘 다 산속 가게)이었다. 이름 규칙과 근거가 다르므로 규칙을 갈라 둔다.
 */
const FOREST_PARCEL_PATTERN = /(?:^|\s)산\s?\d/u;

const TAG_HINTS: Array<[string | RegExp, string[]]> = [
  // food
  ['카페', ['cafe', 'healing']],
  ['커피', ['cafe', 'healing']],
  ['로스터리', ['cafe', 'trendy']],
  ['식당', ['korean', 'family']],
  ['한식', ['korean', 'family']],
  ['국밥', ['korean', 'nostalgic']],
  ['백반', ['korean', 'nostalgic']],
  ['브런치', ['western', 'cafe']],
  ['파스타', ['western']],
  ['스테이크', ['western', 'luxury']],
  ['일식', ['japanese']],
  ['스시', ['japanese', 'luxury']],
  ['초밥', ['japanese']],
  ['라멘', ['japanese']],
  ['오마카세', ['japanese', 'luxury']],
  ['돈카츠', ['japanese']],
  ['중식', ['chinese']],
  ['중화', ['chinese']],
  ['짬뽕', ['chinese']],
  ['마라', ['chinese', 'trendy']],
  ['비건', ['vegan', 'healing']],
  ['채식', ['vegan', 'healing']],
  ['샐러드', ['vegan', 'healing']],
  ['분식', ['bunsik', 'nostalgic']],
  ['떡볶이', ['bunsik', 'nostalgic']],
  ['김밥', ['bunsik']],
  ['고기', ['meat', 'family']],
  ['구이', ['meat', 'family']],
  ['갈비', ['meat', 'family']],
  ['삼겹', ['meat']],
  ['곱창', ['meat']],
  ['횟집', ['seafood']],
  ['물회', ['seafood']],
  ['해물', ['seafood']],
  ['해산물', ['seafood']],
  ['조개', ['seafood', 'beach']],
  ['수산', ['seafood']],
  ['베이커리', ['bakery', 'cafe']],
  ['빵', ['bakery', 'cafe']],
  ['제과', ['bakery', 'cafe']],
  ['디저트', ['bakery', 'cafe']],
  ['케이크', ['bakery', 'cafe']],
  // mood
  ['시장', ['nostalgic', 'korean', 'village']],
  ['노포', ['nostalgic', 'korean']],
  ['레트로', ['nostalgic', 'trendy']],
  ['복고', ['nostalgic']],
  ['핫플', ['trendy', 'city']],
  ['편집', ['trendy', 'city']],
  ['소품', ['trendy', 'city']],
  ['호텔', ['luxury', 'city']],
  ['리조트', ['luxury', 'healing']],
  ['프리미엄', ['luxury']],
  ['테마파크', ['adventure', 'family']],
  ['놀이공원', ['adventure', 'family']],
  ['서핑', ['adventure', 'beach']],
  ['등산', ['adventure', 'mountain']],
  ['체험', ['adventure', 'family']],
  ['박물관', ['cultural', 'family']],
  ['미술관', ['cultural', 'city']],
  ['전시', ['cultural', 'city']],
  ['문화', ['cultural', 'city']],
  ['고궁', ['cultural', 'nostalgic']],
  ['사찰', ['cultural', 'healing']],
  ['유적', ['cultural']],
  // environment
  ['해변', ['beach', 'nature']],
  ['바다', ['beach', 'nature']],
  ['해수욕장', ['beach', 'nature']],
  ['해안', ['beach', 'nature']],
  ['숲', ['nature', 'healing']],
  ['수목원', ['nature', 'healing']],
  ['공원', ['nature', 'city']],
  [MOUNTAIN_NAME_PATTERN, ['mountain', 'nature']],
  [FOREST_PARCEL_PATTERN, ['mountain', 'nature']],
  // 제주 오름은 이름에 '산' 이 없어 위 규칙에 안 걸린다(카탈로그 49행).
  ['오름', ['mountain', 'nature']],
  ['산악', ['mountain', 'nature']],
  ['휴양림', ['nature', 'healing']],
  ['폭포', ['nature', 'healing']],
  ['둘레길', ['walk', 'nature']],
  ['계곡', ['mountain', 'nature']],
  ['호수', ['lake', 'nature']],
  ['저수지', ['lake', 'nature']],
  ['강변', ['lake', 'nature']],
  ['수변', ['lake', 'nature']],
  ['섬', ['island', 'nature']],
  ['해상', ['island', 'beach']],
  ['온천', ['hotspring', 'healing']],
  ['스파', ['hotspring', 'healing']],
  ['찜질', ['hotspring', 'healing']],
  ['워터파크', ['hotspring', 'family']],
  ['야경', ['nightview', 'romantic', 'city']],
  ['전망', ['nightview', 'romantic']],
  ['전망대', ['nightview', 'romantic']],
  ['루프탑', ['nightview', 'romantic', 'trendy']],
  ['노을', ['nightview', 'romantic']],
  ['마을', ['village', 'cultural']],
  ['골목', ['village', 'nostalgic']],
  ['산책', ['walk', 'healing']],
];

/**
 * 목적지 문자열에서 행정구역 접미사를 떼어 매칭용 어간을 만든다.
 * 시·군·구 계열은 어간화(예: '서울특별시'→'서울', '경주시'→'경주', '해운대구'→'해운대')하되,
 * 도는 그대로 남긴다(예: '경상북도'→'경상북도', '경기도'→'경기도').
 * 단 '특별자치도'는 '도'로 정규화해 주소('강원도')와 관광공사 정식명('강원특별자치도')이
 * 같은 어간('강원도')으로 맞도록 한다(집중률 시도 인덱스 매칭).
 * 첫 토큰만 사용해 '부산 해운대' 같은 다중 토큰도 시도 어간으로 정규화.
 */
/** 한 토큰의 행정구역 접미사를 어간화. 도는 유지, 특별자치도만 도로 정규화. */
function stemRegionToken(token: string): string {
  return token
    .replace(/특별자치도$/, '도')
    .replace(/(특별자치시|특별시|광역시|자치시|시|군|구)$/, '');
}

export function regionStem(destination: string): string {
  const first = destination.trim().split(/\s+/)[0] ?? '';
  return stemRegionToken(first);
}

/**
 * 목적지의 모든 토큰을 어간화해 합친다. regionStem 이 첫 토큰(시도)만 보는 것과 달리
 * 서브지역까지 보존한다. 예: '부산광역시 해운대구'→'부산 해운대', '경주시'→'경주'.
 * 네이버 검색 질의처럼 목적지 전체 특이성이 필요할 때 쓴다.
 */
export function regionSearchStem(destination: string): string {
  return destination
    .trim()
    .split(/\s+/)
    .map(stemRegionToken)
    .filter(Boolean)
    .join(' ');
}

/**
 * LIKE 프리픽스 매칭용 최단 어간. regionStem 에서 끝의 '도'까지 마저 떼어
 * place_embeddings 에 섞여 있는 짧은 라벨('경기')과 풀네임('경기도')을 '경기%' 로 함께 잡는다.
 * (regionStem 은 도를 유지하지만 그 값은 사용자에게 노출되지 않고, 프리픽스는 최단 어간이 필요.)
 * 예: '경기도'→'경기', '경상북도'→'경상북', '강원특별자치도'→'강원', '경주시'→'경주'.
 */
export function regionPrefixStem(destination: string): string {
  return regionStem(destination).replace(/도$/, '');
}

/**
 * 주소에서 시군구 라벨을 추출한다. 첫 토큰(시도)을 건너뛰고
 * 시/군/구로 끝나는 첫 토큰을 반환. 예: '경상북도 경주시 불국로 385'→'경주시'.
 * 세종특별자치시처럼 시군구가 없으면 null.
 */
export function parseSigungu(address: string): string | null {
  const parts = address.trim().split(/\s+/);
  for (const part of parts.slice(1)) {
    if (/(시|군|구)$/.test(part)) return part;
  }
  return null;
}

export function normalizeDestinationRegion(destination: string): string {
  const normalized = destination.toLowerCase();
  if (normalized.includes('서울') || normalized.includes('seoul')) return 'seoul';
  if (normalized.includes('부산') || normalized.includes('busan')) return 'busan';
  if (normalized.includes('제주') || normalized.includes('jeju')) return 'jeju';
  if (normalized.includes('경주') || normalized.includes('gyeongju')) return 'gyeongju';
  return 'default';
}

export function getSeedPlaces(destination: string): SeedPlace[] {
  const region = normalizeDestinationRegion(destination);
  return SEEDS_BY_REGION[region] ?? DEFAULT_SEEDS;
}

export function getSeedCandidates(destination: string): RawPlaceCandidate[] {
  const region = normalizeDestinationRegion(destination);
  return getSeedPlaces(destination).map((place) => ({
    ...place,
    source: 'seed',
    destinationRegion: region,
  }));
}

export function inferPlaceTags(
  place: Pick<PlaceDto, 'name' | 'category' | 'address'> & { categoryDetail?: string },
): string[] {
  const tags = new Set<string>();
  const haystack = `${place.name} ${place.category} ${place.address} ${place.categoryDetail ?? ''}`;
  for (const [pattern, hints] of TAG_HINTS) {
    const matched =
      typeof pattern === 'string' ? haystack.includes(pattern) : pattern.test(haystack);
    if (matched) {
      hints.forEach((hint) => tags.add(hint));
    }
  }

  if (place.category === 'cafe') tags.add('cafe');
  if (place.category === 'restaurant') tags.add('korean');
  if (place.category === 'park') tags.add('nature');
  if (place.category === 'attraction') tags.add('cultural');
  if (tags.size === 0) tags.add('city');
  return [...tags];
}

/** 검색 개인화에 사용할 수 있는 최소 사진 분석 신뢰도. */
export const MIN_ACTIONABLE_TASTE_CONFIDENCE = 0.35;

export function tasteTagsToKeywords(tasteTags?: TasteTagDto): string[] {
  // 애매한 사진 분석 결과가 목적지와 동선 신호보다 강하게 작동하지 않게 한다.
  if (
    !tasteTags ||
    !Number.isFinite(tasteTags.confidence) ||
    tasteTags.confidence < MIN_ACTIONABLE_TASTE_CONFIDENCE
  ) {
    return [];
  }
  return [
    ...(tasteTags.food ?? []),
    ...(tasteTags.mood ?? []),
    ...(tasteTags.environment ?? []),
  ];
}

export function buildPlaceEmbeddingText(place: SeedPlace | RawPlaceCandidate): string {
  const tags = place.tags?.join(', ') ?? inferPlaceTags(place).join(', ');
  return [place.name, place.category, place.address, tags].filter(Boolean).join(' | ');
}
