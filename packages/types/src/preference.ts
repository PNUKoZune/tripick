export type FoodPreference = 'korean' | 'japanese' | 'western' | 'chinese' | 'vegan' | 'cafe';
export type MoodPreference = 'healing' | 'adventure' | 'romantic' | 'family' | 'cultural';
export type EnvironmentPreference = 'nature' | 'city' | 'beach' | 'mountain' | 'village';
export type TravelStylePreference =
  | 'korean_vibe'
  | 'healing'
  | 'food_trip'
  | 'nature'
  | 'shopping'
  | 'insta_spot';
export type CompanionPreference = 'solo' | 'couple' | 'friends' | 'family';
export type TransportPreference = 'transit' | 'walk' | 'car' | 'rental_car';

/** 관심 테마 (세분화된 취향 태그) */
export type InterestPreference =
  | 'history'
  | 'art'
  | 'nature'
  | 'nightview'
  | 'photo'
  | 'shopping'
  | 'food'
  | 'activity'
  | 'cafe'
  | 'local';

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
  travelStyles: TravelStylePreference[];
  companions: CompanionPreference[];
  sleepTime: string;
  wakeTime: string;
  transportModes: TransportPreference[];
  /** 관심 테마 (세분화) */
  interests: InterestPreference[];
  /** 여행 페이스 */
  pace: TravelPace;
  /** 활동 강도 */
  activityIntensity: ActivityIntensity;
  /** 혼잡도·분위기 선호 */
  crowdPreference: CrowdPreference;
  instagramConnected: boolean;
  instagramTags: string[];
}

export interface UpdatePreferenceDto {
  tasteTags: Partial<TasteTagDto>;
  profile?: Partial<PreferenceProfileDto>;
}
