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
  /** 사용자가 올린 취향 원본 사진 URL (Object Storage) */
  photoUrls?: string[];
  /** 사진별 분석 결과 (key = 사진 URL). 사진 추가·삭제 시 재집계에 쓰인다. */
  photoTags?: Record<string, TasteTagDto>;
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
  /** 지정 시 취향 사진 URL 을 통째로 교체 */
  photoUrls?: string[];
  /** 지정 시 사진별 분석 결과를 통째로 교체 (key = 사진 URL) */
  photoTags?: Record<string, TasteTagDto>;
}

/** 한 번에 업로드할 수 있는 취향 사진 수 */
export const MAX_PREFERENCE_UPLOAD = 3;
/** 사용자당 보관하는 취향 사진 총 개수 */
export const MAX_PREFERENCE_PHOTOS = 10;

export type PreferenceAnalysisStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unknown';

/** 취향 사진 분석 잡 상태. 업로드 응답과 상태 조회가 같은 형태를 쓴다. */
export interface PreferenceAnalysisJobDto {
  jobId: string;
  status: PreferenceAnalysisStatus;
  /** 분석 완료한 사진 수 */
  analyzed: number;
  /** 이번 잡이 분석해야 할 사진 수 */
  total: number;
  /** 완료 시에만 채워지는 최종 취향 태그 */
  tasteTags?: TasteTagDto;
  /**
   * 보관 중인 전체 사진 URL. **완료 시에만 채워진다** —
   * 진행 중에는 조회할 이유가 없어 빈 배열이다(폴링마다 DB 를 보지 않기 위해).
   */
  photoUrls: string[];
  /** 실패 사유 (status=failed) */
  error?: string;
}
