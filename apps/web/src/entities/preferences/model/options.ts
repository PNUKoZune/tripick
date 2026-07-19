import type {
  ActivityIntensity,
  CrowdPreference,
  EnvironmentPreference,
  FoodPreference,
  MoodPreference,
  ThemePreference,
  TransportPreference,
  TravelPace,
} from '@tripick/types';

export const TRANSPORT_OPTIONS: Array<{ value: TransportPreference; label: string }> = [
  { value: 'transit', label: '대중교통' },
  { value: 'car', label: '자가용' },
  { value: 'walk', label: '도보' },
  { value: 'rental_car', label: '렌터카' },
];

type ThemeTaste = {
  food: FoodPreference[];
  mood: MoodPreference[];
  environment: EnvironmentPreference[];
};

export type ThemeOption = {
  value: ThemePreference;
  label: string;
  /** 이 테마에 속하는 장소 예시 (UI 힌트 + 임베딩 신호) */
  examples: string[];
  /** tasteTags 파생 (임베딩·검색용) */
  taste: ThemeTaste;
};

export type ThemeGroup = {
  key: string;
  label: string;
  themes: ThemeOption[];
};

/** 대분류 → 세부 테마. 각 테마는 기본 중립이며 선호/불호로 선택. */
export const THEME_GROUPS: ThemeGroup[] = [
  {
    key: 'nature',
    label: '자연·풍경',
    themes: [
      {
        value: 'mountain_forest',
        label: '산·숲',
        examples: ['국립공원', '수목원', '등산로'],
        taste: { food: [], mood: ['healing'], environment: ['nature', 'mountain'] },
      },
      {
        value: 'beach',
        label: '바다·해변',
        examples: ['해수욕장', '해안 산책로'],
        taste: { food: [], mood: ['healing'], environment: ['beach', 'nature'] },
      },
      {
        value: 'lake_river',
        label: '호수·강',
        examples: ['호수공원', '강변'],
        taste: { food: [], mood: ['healing'], environment: ['nature'] },
      },
      {
        value: 'park_garden',
        label: '공원·정원',
        examples: ['도시공원', '식물원'],
        taste: { food: [], mood: ['healing'], environment: ['nature', 'city'] },
      },
    ],
  },
  {
    key: 'culture',
    label: '예술·문화',
    themes: [
      {
        value: 'exhibition',
        label: '전시',
        examples: ['미술관', '전시회', '갤러리'],
        taste: { food: ['cafe'], mood: ['cultural'], environment: ['city'] },
      },
      {
        value: 'heritage',
        label: '역사·유적',
        examples: ['고궁', '사찰', '유적지'],
        taste: { food: [], mood: ['cultural'], environment: ['village'] },
      },
      {
        value: 'performance',
        label: '공연',
        examples: ['콘서트', '연극', '뮤지컬'],
        taste: { food: [], mood: ['cultural'], environment: ['city'] },
      },
      {
        value: 'museum',
        label: '박물관',
        examples: ['박물관', '과학관'],
        taste: { food: [], mood: ['cultural', 'family'], environment: ['city'] },
      },
    ],
  },
  {
    key: 'food',
    label: '미식',
    themes: [
      {
        value: 'local_food',
        label: '로컬 맛집',
        examples: ['노포', '향토음식'],
        taste: { food: ['korean'], mood: ['cultural'], environment: ['village'] },
      },
      {
        value: 'cafe_dessert',
        label: '카페·디저트',
        examples: ['감성카페', '베이커리'],
        taste: { food: ['cafe'], mood: ['healing'], environment: ['city'] },
      },
      {
        value: 'bar',
        label: '술·바',
        examples: ['와인바', '펍'],
        taste: { food: ['western'], mood: ['romantic'], environment: ['city'] },
      },
      {
        value: 'market_street',
        label: '시장·길거리',
        examples: ['전통시장', '야시장'],
        taste: { food: ['korean'], mood: ['family'], environment: ['village'] },
      },
    ],
  },
  {
    key: 'activity',
    label: '액티비티·체험',
    themes: [
      {
        value: 'sports',
        label: '레저·스포츠',
        examples: ['서핑', '카약'],
        taste: { food: [], mood: ['adventure'], environment: ['nature', 'beach'] },
      },
      {
        value: 'themepark',
        label: '테마파크',
        examples: ['놀이공원', '워터파크'],
        taste: { food: [], mood: ['adventure', 'family'], environment: ['city'] },
      },
      {
        value: 'class',
        label: '원데이클래스',
        examples: ['공방', '쿠킹클래스'],
        taste: { food: [], mood: ['cultural'], environment: ['city'] },
      },
      {
        value: 'wellness',
        label: '웰니스',
        examples: ['온천', '스파'],
        taste: { food: [], mood: ['healing'], environment: ['nature'] },
      },
    ],
  },
  {
    key: 'shopping',
    label: '쇼핑·거리',
    themes: [
      {
        value: 'select_shop',
        label: '편집숍·소품',
        examples: ['편집숍', '디자인숍'],
        taste: { food: ['cafe'], mood: ['family'], environment: ['city'] },
      },
      {
        value: 'mall',
        label: '백화점·아울렛',
        examples: ['백화점', '아울렛'],
        taste: { food: [], mood: ['family'], environment: ['city'] },
      },
      {
        value: 'local_street',
        label: '로컬 골목',
        examples: ['핫플 거리', '동네 상권'],
        taste: { food: ['cafe'], mood: ['cultural'], environment: ['village'] },
      },
    ],
  },
  {
    key: 'view',
    label: '뷰·감성',
    themes: [
      {
        value: 'nightview',
        label: '야경·노을',
        examples: ['전망대', '루프탑'],
        taste: { food: [], mood: ['romantic'], environment: ['city'] },
      },
      {
        value: 'photo_spot',
        label: '사진 스팟',
        examples: ['포토존', '감성 명소'],
        taste: { food: ['cafe'], mood: ['romantic'], environment: ['city'] },
      },
      {
        value: 'unique_space',
        label: '이색 공간',
        examples: ['독립서점', '복합문화공간'],
        taste: { food: [], mood: ['cultural'], environment: ['city'] },
      },
    ],
  },
];

/** 테마 value → taste 매핑 (선호 테마의 tasteTags 파생용) */
export const THEME_TO_TASTE: Record<ThemePreference, ThemeTaste> = Object.fromEntries(
  THEME_GROUPS.flatMap((group) => group.themes.map((theme) => [theme.value, theme.taste])),
) as Record<ThemePreference, ThemeTaste>;

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

/** tasteTags(food·mood·environment) 영문 enum → 한국어 표시 라벨 (키 중복 없음) */
export const TASTE_TAG_LABELS: Record<string, string> = {
  // food
  korean: '한식',
  japanese: '일식',
  western: '양식',
  chinese: '중식',
  vegan: '비건',
  cafe: '카페',
  bunsik: '분식',
  meat: '고기·구이',
  seafood: '해산물',
  bakery: '베이커리',
  // mood
  healing: '힐링',
  adventure: '액티비티',
  romantic: '로맨틱',
  family: '가족',
  cultural: '문화·역사',
  nostalgic: '레트로',
  trendy: '트렌디',
  luxury: '프리미엄',
  // environment
  nature: '자연',
  city: '도시',
  beach: '바다',
  mountain: '산',
  village: '로컬 골목',
  lake: '호수·강',
  island: '섬',
  hotspring: '온천·스파',
  nightview: '야경·전망',
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
