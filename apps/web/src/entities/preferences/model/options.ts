import type {
  ActivityIntensity,
  CompanionPreference,
  CrowdPreference,
  EnvironmentPreference,
  FoodPreference,
  InterestPreference,
  MoodPreference,
  TransportPreference,
  TravelPace,
  TravelStylePreference,
} from '@tripick/types';

export const TRAVEL_STYLE_OPTIONS: Array<{ value: TravelStylePreference; label: string }> = [
  { value: 'korean_vibe', label: '한옥 감성' },
  { value: 'healing', label: '힐링·휴양' },
  { value: 'food_trip', label: '미식 탐방' },
  { value: 'nature', label: '자연·동산' },
  { value: 'shopping', label: '쇼핑' },
  { value: 'insta_spot', label: '인스타 스팟' },
];

export const COMPANION_OPTIONS: Array<{ value: CompanionPreference; label: string }> = [
  { value: 'solo', label: '혼자' },
  { value: 'couple', label: '연인' },
  { value: 'friends', label: '친구' },
  { value: 'family', label: '가족' },
];

export const TRANSPORT_OPTIONS: Array<{ value: TransportPreference; label: string }> = [
  { value: 'transit', label: '대중교통' },
  { value: 'car', label: '자가용' },
  { value: 'walk', label: '도보' },
  { value: 'rental_car', label: '렌터카' },
];

export const INTEREST_OPTIONS: Array<{ value: InterestPreference; label: string }> = [
  { value: 'history', label: '역사·유적' },
  { value: 'art', label: '예술·전시' },
  { value: 'nature', label: '자연·풍경' },
  { value: 'nightview', label: '야경·노을' },
  { value: 'photo', label: '사진 스팟' },
  { value: 'shopping', label: '쇼핑' },
  { value: 'food', label: '미식' },
  { value: 'activity', label: '액티비티' },
  { value: 'cafe', label: '카페·디저트' },
  { value: 'local', label: '로컬 골목' },
];

export const PACE_OPTIONS: Array<{ value: TravelPace; label: string; hint: string }> = [
  { value: 'packed', label: '알차게', hint: '많은 장소' },
  { value: 'balanced', label: '적당히', hint: '균형' },
  { value: 'relaxed', label: '여유롭게', hint: '느긋한 동선' },
];

export const ACTIVITY_INTENSITY_OPTIONS: Array<{
  value: ActivityIntensity;
  label: string;
  hint: string;
}> = [
  { value: 'active', label: '활동적', hint: '액티비티 위주' },
  { value: 'moderate', label: '보통', hint: '적당한 활동' },
  { value: 'restful', label: '휴식형', hint: '편안하게' },
];

export const CROWD_OPTIONS: Array<{ value: CrowdPreference; label: string; hint: string }> = [
  { value: 'hotspot', label: '핫플', hint: '인기 명소' },
  { value: 'balanced', label: '상관없음', hint: '' },
  { value: 'quiet', label: '한적한 곳', hint: '숨은 명소' },
];

/** 관심 테마 → tasteTags 파생 (임베딩·검색용) */
export const INTEREST_TO_TASTE: Record<
  InterestPreference,
  {
    food: FoodPreference[];
    mood: MoodPreference[];
    environment: EnvironmentPreference[];
  }
> = {
  history: { food: [], mood: ['cultural'], environment: ['village'] },
  art: { food: ['cafe'], mood: ['cultural'], environment: ['city'] },
  nature: { food: [], mood: ['healing'], environment: ['nature', 'mountain'] },
  nightview: { food: [], mood: ['romantic'], environment: ['city'] },
  photo: { food: ['cafe'], mood: ['romantic'], environment: ['city'] },
  shopping: { food: ['cafe'], mood: ['family'], environment: ['city'] },
  food: { food: ['korean', 'western'], mood: ['family'], environment: ['city'] },
  activity: { food: [], mood: ['adventure'], environment: ['nature', 'beach'] },
  cafe: { food: ['cafe'], mood: ['healing'], environment: ['city'] },
  local: { food: ['korean'], mood: ['cultural'], environment: ['village'] },
};

export const INSTAGRAM_TAGS = ['미식', '자연', '도시'] as const;

export const STYLE_TO_TASTE: Record<
  TravelStylePreference,
  {
    food: FoodPreference[];
    mood: MoodPreference[];
    environment: EnvironmentPreference[];
  }
> = {
  korean_vibe: { food: ['korean'], mood: ['cultural'], environment: ['village'] },
  healing: { food: ['cafe'], mood: ['healing'], environment: ['nature'] },
  food_trip: { food: ['korean', 'cafe'], mood: ['cultural'], environment: ['city'] },
  nature: { food: ['korean'], mood: ['healing'], environment: ['nature', 'mountain'] },
  shopping: { food: ['cafe'], mood: ['family'], environment: ['city'] },
  insta_spot: { food: ['cafe'], mood: ['romantic'], environment: ['city'] },
};

export const MEMBER_FOOD_OPTIONS = [
  { value: 'korean', label: '한식·전통' },
  { value: 'cafe', label: '카페' },
  { value: 'western', label: '양식' },
] as const;

export const MEMBER_MOOD_OPTIONS = [
  { value: 'healing', label: '힐링' },
  { value: 'cultural', label: '문화·역사' },
  { value: 'adventure', label: '액티비티' },
] as const;

export const MEMBER_ENVIRONMENT_OPTIONS = [
  { value: 'city', label: '도시' },
  { value: 'nature', label: '자연' },
  { value: 'village', label: '로컬 골목' },
] as const;
