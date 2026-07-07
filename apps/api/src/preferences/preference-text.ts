import type {
  ActivityIntensity,
  CrowdPreference,
  InterestPreference,
  PreferenceProfileDto,
  TasteTagDto,
  TravelPace,
  TravelStylePreference,
} from '@tripick/types';

/**
 * 취향 태그 + 프로필을 place_embeddings 와 같은 공간에서 검색되도록 키워드 문장으로 직렬화한다.
 * 이 텍스트가 임베딩되어 개인화 검색 벡터가 된다.
 *
 * place 태그(inferPlaceTags)는 영문 enum(cafe, nature, cultural...) 어휘를 쓰므로,
 * 실제 임베딩 모델이 없을 때(해시 폴백)도 겹치도록 스타일/관심 테마를 **영문 태그로도** 병기하고
 * (STYLE_TAGS/INTEREST_TAGS), 의미 보강용 한국어 키워드를 함께 넣는다.
 */

// FE STYLE_TO_TASTE / INTEREST_TO_TASTE 와 동일한 place 태그 어휘. 해시 폴백 정합성 확보용.
const STYLE_TAGS: Record<TravelStylePreference, string[]> = {
  korean_vibe: ['korean', 'cultural', 'village'],
  healing: ['cafe', 'healing', 'nature'],
  food_trip: ['korean', 'cafe', 'city'],
  nature: ['nature', 'mountain', 'healing'],
  shopping: ['cafe', 'city'],
  insta_spot: ['cafe', 'romantic', 'city'],
};

const INTEREST_TAGS: Record<InterestPreference, string[]> = {
  history: ['cultural', 'village'],
  art: ['cultural', 'cafe', 'city'],
  nature: ['nature', 'mountain'],
  nightview: ['romantic', 'city'],
  photo: ['cafe', 'romantic', 'city'],
  shopping: ['cafe', 'city'],
  food: ['korean', 'western'],
  activity: ['adventure', 'nature', 'beach'],
  cafe: ['cafe', 'healing'],
  local: ['korean', 'village', 'cultural'],
};

const STYLE_KEYWORDS: Record<TravelStylePreference, string[]> = {
  korean_vibe: ['한옥', '전통', '고즈넉한'],
  healing: ['힐링', '휴양', '여유'],
  food_trip: ['미식', '맛집', '로컬 음식'],
  nature: ['자연', '숲', '산책'],
  shopping: ['쇼핑', '상점'],
  insta_spot: ['사진 스팟', '감성', '뷰맛집'],
};

const INTEREST_KEYWORDS: Record<InterestPreference, string[]> = {
  history: ['역사', '유적', '문화재'],
  art: ['예술', '미술관', '전시'],
  nature: ['자연', '풍경', '공원'],
  nightview: ['야경', '노을', '밤 산책'],
  photo: ['사진 스팟', '포토존', '감성 뷰'],
  shopping: ['쇼핑', '편집숍', '거리'],
  food: ['미식', '맛집', '먹거리'],
  activity: ['액티비티', '체험', '레저'],
  cafe: ['카페', '디저트', '커피'],
  local: ['로컬', '골목', '동네'],
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

  for (const style of profile?.travelStyles ?? []) {
    tokens.push(...(STYLE_TAGS[style] ?? []));
    tokens.push(...(STYLE_KEYWORDS[style] ?? []));
  }
  for (const interest of profile?.interests ?? []) {
    tokens.push(...(INTEREST_TAGS[interest] ?? []));
    tokens.push(...(INTEREST_KEYWORDS[interest] ?? []));
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
