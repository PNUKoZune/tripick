export type FoodPreference = 'korean' | 'japanese' | 'western' | 'chinese' | 'vegan' | 'cafe';
export type MoodPreference = 'healing' | 'adventure' | 'romantic' | 'family' | 'cultural';
export type EnvironmentPreference = 'nature' | 'city' | 'beach' | 'mountain' | 'village';

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
  /** pgvector 임베딩 ID 참조 */
  embeddingId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePreferenceDto {
  tasteTags: Partial<TasteTagDto>;
}
