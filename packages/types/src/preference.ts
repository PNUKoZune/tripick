export type FoodPreference = 'korean' | 'japanese' | 'western' | 'chinese' | 'vegan' | 'cafe';
export type MoodPreference = 'healing' | 'adventure' | 'romantic' | 'family' | 'cultural';
export type EnvironmentPreference = 'nature' | 'city' | 'beach' | 'mountain' | 'village';
export type TransportPreference = 'transit' | 'walk' | 'car' | 'rental_car';

/**
 * 관심 테마 (대분류 → 세부 테마). 각 테마는 기본 중립이며 선호/불호로 나뉜다.
 * likedThemes / dislikedThemes 두 배열로 저장.
 */
export type ThemePreference =
  // 자연·풍경
  | 'mountain_forest'
  | 'beach'
  | 'lake_river'
  | 'park_garden'
  // 예술·문화
  | 'exhibition'
  | 'heritage'
  | 'performance'
  | 'museum'
  // 미식
  | 'local_food'
  | 'cafe_dessert'
  | 'bar'
  | 'market_street'
  // 액티비티·체험
  | 'sports'
  | 'themepark'
  | 'class'
  | 'wellness'
  // 쇼핑·거리
  | 'select_shop'
  | 'mall'
  | 'local_street'
  // 뷰·감성
  | 'nightview'
  | 'photo_spot'
  | 'unique_space';

/** 여행 페이스: 빡빡한 일정 ~ 여유로운 일정 */
export type TravelPace = 'packed' | 'balanced' | 'relaxed';

/** 활동 강도: 액티비티 위주 ~ 휴식 위주 */
export type ActivityIntensity = 'active' | 'moderate' | 'restful';

/** 혼잡도·분위기 선호: 붐비는 핫플 ~ 한적한 로컬 */
export type CrowdPreference = 'hotspot' | 'balanced' | 'quiet';

export interface TasteTagDto {
  food: FoodPreference[];
  mood: MoodPreference[];
  environment: EnvironmentPreference[];
  /** 분석 신뢰도 0~1 */
  confidence: number;
}

export interface PreferenceDto {
  id: string;
  userId: string;
  tasteTags: TasteTagDto;
  profile?: PreferenceProfileDto;
  /** pgvector 임베딩 ID 참조 */
  embeddingId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PreferenceProfileDto {
  sleepTime: string;
  wakeTime: string;
  transportModes: TransportPreference[];
  /** 선호하는 관심 테마 */
  likedThemes: ThemePreference[];
  /** 불호하는 관심 테마 */
  dislikedThemes: ThemePreference[];
  /** 여행 페이스 */
  pace: TravelPace;
  /** 활동 강도 */
  activityIntensity: ActivityIntensity;
  /** 혼잡도·분위기 선호 */
  crowdPreference: CrowdPreference;
}

export interface UpdatePreferenceDto {
  tasteTags: Partial<TasteTagDto>;
  profile?: Partial<PreferenceProfileDto>;
}
