import type {
  ActivityIntensity,
  CrowdPreference,
  EnvironmentPreference,
  FoodPreference,
  MoodPreference,
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
 *
 * 토큰은 **가중치만큼 반복**해서 내보낸다. 원격 모델(평균 풀링)과 해시 폴백
 * (토큰마다 벡터에 누적) 양쪽 모두 반복 횟수가 그대로 비중이 되기 때문이다.
 * 단순 중복 제거를 쓰면 사진 분석이 뽑은 태그가 프로필 테마 확장 토큰에 묻히고,
 * 두 소스가 같은 태그를 지목했다는 정보(합의)도 사라진다.
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

/**
 * 사진 분석 태그의 한국어 보강 키워드.
 * 프로필 테마는 THEME_KEYWORDS 로 한국어 토큰을 얻는데 취향 태그는 영문 enum 뿐이라,
 * 같은 신호라도 한국어 위주인 장소 텍스트와 겹칠 여지가 적었다.
 */
const TASTE_KEYWORDS: Record<
  FoodPreference | MoodPreference | EnvironmentPreference,
  string[]
> = {
  // food
  korean: ['한식', '한정식', '백반'],
  japanese: ['일식', '스시', '라멘'],
  western: ['양식', '파스타', '스테이크'],
  chinese: ['중식', '중화요리'],
  vegan: ['비건', '채식', '샐러드'],
  cafe: ['카페', '커피', '디저트'],
  bunsik: ['분식', '떡볶이', '김밥'],
  meat: ['고기', '구이', '갈비'],
  seafood: ['해산물', '회', '해물'],
  bakery: ['베이커리', '빵집', '제과'],
  // mood
  healing: ['힐링', '휴식', '한적한'],
  adventure: ['액티비티', '체험', '모험'],
  romantic: ['로맨틱', '분위기 좋은', '데이트'],
  family: ['가족', '아이와 함께', '나들이'],
  cultural: ['문화', '역사', '전시'],
  nostalgic: ['레트로', '노포', '옛 정취'],
  trendy: ['핫플레이스', '요즘 뜨는', '감성'],
  luxury: ['프리미엄', '고급', '호캉스'],
  // environment
  nature: ['자연', '숲', '풍경'],
  city: ['도심', '도시', '번화가'],
  beach: ['바다', '해변', '해수욕장'],
  mountain: ['산', '등산', '계곡'],
  village: ['마을', '골목', '로컬'],
  lake: ['호수', '강변', '수변'],
  island: ['섬', '해상', '유람선'],
  hotspring: ['온천', '스파', '찜질'],
  nightview: ['야경', '전망', '노을'],
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

/** 프로필에서 온 토큰의 기본 비중. */
const PROFILE_WEIGHT = 1;
/**
 * 한 토큰이 반복될 수 있는 최대 횟수.
 * 사진·프로필이 모두 지목한 고신뢰 태그(3+1=4)까지만 허용하고, 그 이상은 잘라
 * 태그 하나가 벡터를 독점하지 않게 한다.
 */
const MAX_REPEAT = 4;

/**
 * 사진 분석 태그의 비중. confidence 가 높을수록 크게 잡는다.
 * 0.0 → 1, 0.5 → 2, 1.0 → 3. 프로필(1)보다 최소 같거나 크다 —
 * 사진은 사용자가 직접 고른 테마보다 표본은 적어도 구체적인 신호라서.
 */
function tasteWeight(confidence: number): number {
  const safe = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
  return 1 + Math.round(safe * 2);
}

export function buildPreferenceText(
  tasteTags?: Partial<TasteTagDto>,
  profile?: Partial<PreferenceProfileDto>,
): string {
  // 토큰별 비중 누적. 같은 토큰을 여러 소스가 지목하면 그만큼 더해진다.
  const weights = new Map<string, number>();
  const add = (token: string, weight: number) => {
    if (!token) return;
    weights.set(token, (weights.get(token) ?? 0) + weight);
  };

  const photoWeight = tasteWeight(tasteTags?.confidence ?? 0);
  const tasteTagList = [
    ...(tasteTags?.food ?? []),
    ...(tasteTags?.mood ?? []),
    ...(tasteTags?.environment ?? []),
  ];
  for (const tag of tasteTagList) {
    add(tag, photoWeight);
    // 한국어 보강 키워드는 태그 본체보다 한 단계 낮게 — 의미 보강이지 정본이 아니다.
    for (const keyword of TASTE_KEYWORDS[tag] ?? []) add(keyword, Math.max(1, photoWeight - 1));
  }

  for (const theme of profile?.likedThemes ?? []) {
    for (const tag of THEME_TAGS[theme] ?? []) add(tag, PROFILE_WEIGHT);
    for (const keyword of THEME_KEYWORDS[theme] ?? []) add(keyword, PROFILE_WEIGHT);
  }
  if (profile?.pace) {
    for (const keyword of PACE_KEYWORDS[profile.pace] ?? []) add(keyword, PROFILE_WEIGHT);
  }
  if (profile?.activityIntensity) {
    for (const keyword of INTENSITY_KEYWORDS[profile.activityIntensity] ?? []) {
      add(keyword, PROFILE_WEIGHT);
    }
  }
  if (profile?.crowdPreference) {
    for (const keyword of CROWD_KEYWORDS[profile.crowdPreference] ?? []) {
      add(keyword, PROFILE_WEIGHT);
    }
  }

  // 비중이 큰 토큰부터, 비중만큼 반복해 늘어놓는다.
  const tokens = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .flatMap(([token, weight]) => Array<string>(Math.min(weight, MAX_REPEAT)).fill(token));

  // 취향 신호가 전혀 없으면 빈 문자열 반환 → 호출부에서 제네릭 벡터 저장을 건너뛴다.
  return tokens.join(', ');
}
