/**
 * 취향 태그 어휘. 사진 분석(VisionAnalyzer)·장소 태깅(inferPlaceTags)·임베딩 직렬화가
 * 모두 이 배열을 정본으로 쓴다. 여기에 값을 추가하면 장소 쪽 키워드(TAG_HINTS)도
 * 같이 늘려야 매칭될 장소가 생긴다.
 */
export const FOOD_PREFERENCES = [
  'korean',
  'japanese',
  'western',
  'chinese',
  'vegan',
  'cafe',
  'bunsik',
  'meat',
  'seafood',
  'bakery',
] as const;

export const MOOD_PREFERENCES = [
  'healing',
  'adventure',
  'romantic',
  'family',
  'cultural',
  'nostalgic',
  'trendy',
  'luxury',
] as const;

export const ENVIRONMENT_PREFERENCES = [
  'nature',
  'city',
  'beach',
  'mountain',
  'village',
  'lake',
  'island',
  'hotspring',
  'nightview',
] as const;

export type FoodPreference = (typeof FOOD_PREFERENCES)[number];
export type MoodPreference = (typeof MOOD_PREFERENCES)[number];
export type EnvironmentPreference = (typeof ENVIRONMENT_PREFERENCES)[number];

/** 세 축을 합친 취향 태그 값. 사진별 태그 on/off 처럼 축을 가리지 않는 곳에서 쓴다. */
export type TasteTagValue = FoodPreference | MoodPreference | EnvironmentPreference;

export const ALL_TASTE_TAGS: readonly TasteTagValue[] = [
  ...FOOD_PREFERENCES,
  ...MOOD_PREFERENCES,
  ...ENVIRONMENT_PREFERENCES,
];

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
  /** 사용자가 올린 취향 사진 (비공개 버킷 키 + 만료되는 표시용 URL) */
  photos?: PreferencePhotoRefDto[];
  /** 사진별 분석 결과 (key = 스토리지 키). 사진 추가·삭제 시 재집계에 쓰인다. */
  photoTags?: Record<string, TasteTagDto>;
  /** 사용자가 끈 사진별 태그 (key = 스토리지 키). 분석 결과는 그대로 두고 집계에서만 제외한다. */
  disabledPhotoTags?: Record<string, TasteTagValue[]>;
  /** pgvector 임베딩 ID 참조 */
  embeddingId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PreferenceProfileDto {
  sleepTime: string;
  wakeTime: string;
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
  /** 지정 시 취향 사진 키 목록을 통째로 교체 */
  photoKeys?: string[];
  /** 지정 시 사진별 분석 결과를 통째로 교체 (key = 스토리지 키) */
  photoTags?: Record<string, TasteTagDto>;
  /** 지정 시 사진별 비활성 태그 목록을 통째로 교체 (key = 스토리지 키) */
  disabledPhotoTags?: Record<string, TasteTagValue[]>;
}

/** 특정 사진에서 추출된 특정 태그를 켜고 끈다. */
export interface TogglePhotoTagDto {
  /** 대상 사진의 스토리지 키. 표시용 서명 URL 은 만료되므로 식별자로 쓸 수 없다. */
  key: string;
  tag: TasteTagValue;
  /** true = 집계에 반영, false = 제외 */
  enabled: boolean;
}

/**
 * 취향 사진 한 장을 가리키는 값.
 *
 * `key` 가 **정본 식별자**다(스토리지 키). 예전에는 공개 URL 문자열이 식별자 겸 표시용이었는데,
 * 비공개 버킷으로 옮기면서 표시용 URL 이 **만료되는 서명 URL** 이 됐다 — 매번 값이 바뀌므로
 * 식별자로 쓸 수 없다(태그 매핑이 끊긴다). 삭제·태그 토글은 `key` 로 지목한다.
 *
 * `url` 은 표시용이고 15분 뒤 만료된다. 만료 후에도 화면에 남아 있으면 이미지가 깨지므로
 * 클라이언트는 이 목록을 그보다 짧은 주기로 다시 받아야 한다.
 */
export interface PreferencePhotoRefDto {
  key: string;
  url: string;
}

/** 사진 한 장과 그 사진에서 뽑힌 태그의 on/off 상태. */
export interface PreferencePhotoTagsDto {
  /** 정본 식별자(스토리지 키). 토글·삭제가 이 값을 보낸다. */
  key: string;
  /** 표시용 서명 URL. 만료되므로 저장하지 말 것. */
  url: string;
  tags: Array<{ tag: TasteTagValue; enabled: boolean }>;
  /**
   * 분석이 끝난 사진인지. `tags` 가 비어 있는 이유가 "취향을 못 찾음"인지
   * "아직 분석되지 않음(잡 실패)"인지 화면이 구분하려면 별도 신호가 필요하다.
   */
  analyzed: boolean;
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
   * 보관 중인 전체 사진(키 + 표시용 서명 URL). **완료 시에만 채워진다** —
   * 진행 중에는 조회할 이유가 없어 빈 배열이다(폴링마다 DB 를 보지 않기 위해).
   */
  photos: PreferencePhotoRefDto[];
  /** 실패 사유 (status=failed) */
  error?: string;
}
