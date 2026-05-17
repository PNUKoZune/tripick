import type {
  CompanionPreference,
  EnvironmentPreference,
  FoodPreference,
  MoodPreference,
  TransportPreference,
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
