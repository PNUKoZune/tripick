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
  instagramConnected: boolean;
  instagramTags: string[];
}

export interface UpdatePreferenceDto {
  tasteTags: Partial<TasteTagDto>;
  profile?: Partial<PreferenceProfileDto>;
}
