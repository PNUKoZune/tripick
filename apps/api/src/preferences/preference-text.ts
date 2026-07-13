import type {
  ActivityIntensity,
  CrowdPreference,
  PreferenceProfileDto,
  TasteTagDto,
  ThemePreference,
  TravelPace,
} from '@tripick/types';

/**
 * 취향 태그 + 프로필을 place_embeddings 와 같은 공간에서 검색되도록 키워드 문장으로 직렬화한다.
 * 이 텍스트가 임베딩되어 개인화 검색 벡터가 된다.
 *
 * place 태그(inferPlaceTags)는 영문 enum(cafe, nature, cultural...) 어휘를 쓰므로,
 * 실제 임베딩 모델이 없을 때(해시 폴백)도 겹치도록 선호 테마를 **영문 태그로도** 병기하고
 * (THEME_TAGS), 의미 보강용 한국어 키워드를 함께 넣는다.
 * 불호 테마(dislikedThemes)는 양의 신호가 아니므로 텍스트에 포함하지 않는다.
 */

// FE THEME_TO_TASTE 와 동일한 place 태그 어휘. 해시 폴백 정합성 확보용.
const THEME_TAGS: Record<ThemePreference, string[]> = {
  mountain_forest: ['nature', 'mountain', 'healing'],
  beach: ['beach', 'nature', 'healing'],
  lake_river: ['nature', 'healing'],
  park_garden: ['nature', 'city', 'healing'],
  exhibition: ['cultural', 'cafe', 'city'],
  heritage: ['cultural', 'village'],
  performance: ['cultural', 'city'],
  museum: ['cultural', 'family', 'city'],
  local_food: ['korean', 'cultural', 'village'],
  cafe_dessert: ['cafe', 'healing', 'city'],
  bar: ['western', 'romantic', 'city'],
  market_street: ['korean', 'family', 'village'],
  sports: ['adventure', 'nature', 'beach'],
  themepark: ['adventure', 'family', 'city'],
  class: ['cultural', 'city'],
  wellness: ['healing', 'nature'],
  select_shop: ['cafe', 'family', 'city'],
  mall: ['family', 'city'],
  local_street: ['cafe', 'cultural', 'village'],
  nightview: ['romantic', 'city'],
  photo_spot: ['cafe', 'romantic', 'city'],
  unique_space: ['cultural', 'city'],
};

const THEME_KEYWORDS: Record<ThemePreference, string[]> = {
  mountain_forest: ['산', '숲', '국립공원', '수목원', '등산'],
  beach: ['바다', '해변', '해수욕장', '해안 산책'],
  lake_river: ['호수', '강변', '호수공원'],
  park_garden: ['공원', '정원', '식물원', '산책'],
  exhibition: ['예술', '미술관', '전시', '갤러리'],
  heritage: ['역사', '유적', '고궁', '사찰', '문화재'],
  performance: ['공연', '콘서트', '연극', '뮤지컬'],
  museum: ['박물관', '과학관', '전시관'],
  local_food: ['맛집', '노포', '향토음식', '로컬 음식'],
  cafe_dessert: ['카페', '디저트', '베이커리', '커피'],
  bar: ['술집', '와인바', '펍', '바'],
  market_street: ['시장', '전통시장', '야시장', '길거리 음식'],
  sports: ['레저', '스포츠', '서핑', '카약', '액티비티'],
  themepark: ['테마파크', '놀이공원', '워터파크'],
  class: ['원데이클래스', '공방', '체험'],
  wellness: ['웰니스', '온천', '스파', '힐링'],
  select_shop: ['편집숍', '소품숍', '디자인숍'],
  mall: ['백화점', '아울렛', '쇼핑'],
  local_street: ['로컬', '골목', '거리', '동네'],
  nightview: ['야경', '노을', '전망대', '루프탑'],
  photo_spot: ['사진 스팟', '포토존', '감성'],
  unique_space: ['이색 공간', '독립서점', '복합문화공간'],
};

// 중립(기본) 값은 취향 신호가 아니므로 빈 배열 — 노이즈/제네릭 편향 방지.
const PACE_KEYWORDS: Record<TravelPace, string[]> = {
  packed: ['알찬 일정', '많은 장소'],
  balanced: [],
  relaxed: ['여유로운 일정', '느긋한'],
};

const INTENSITY_KEYWORDS: Record<ActivityIntensity, string[]> = {
  active: ['활동적인', '액티비티 위주'],
  moderate: [],
  restful: ['휴식 위주', '편안한'],
};

const CROWD_KEYWORDS: Record<CrowdPreference, string[]> = {
  hotspot: ['핫플레이스', '인기 명소', '붐비는'],
  balanced: [],
  quiet: ['한적한', '조용한', '숨은 명소'],
};

export function buildPreferenceText(
  tasteTags?: Partial<TasteTagDto>,
  profile?: Partial<PreferenceProfileDto>,
): string {
  const tokens: string[] = [];

  tokens.push(...(tasteTags?.food ?? []));
  tokens.push(...(tasteTags?.mood ?? []));
  tokens.push(...(tasteTags?.environment ?? []));

  for (const theme of profile?.likedThemes ?? []) {
    tokens.push(...(THEME_TAGS[theme] ?? []));
    tokens.push(...(THEME_KEYWORDS[theme] ?? []));
  }
  if (profile?.pace) tokens.push(...(PACE_KEYWORDS[profile.pace] ?? []));
  if (profile?.activityIntensity) {
    tokens.push(...(INTENSITY_KEYWORDS[profile.activityIntensity] ?? []));
  }
  if (profile?.crowdPreference) tokens.push(...(CROWD_KEYWORDS[profile.crowdPreference] ?? []));

  const unique = [...new Set(tokens.filter(Boolean))];
  // 취향 신호가 전혀 없으면 빈 문자열 반환 → 호출부에서 제네릭 벡터 저장을 건너뛴다.
  return unique.join(', ');
}
