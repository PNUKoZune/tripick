import type {
  PlannerAlternativeResponseDto,
  PlannerTripDto,
} from '@tripick/types';

/**
 * Screen 3/4 데모용 고정 mock.
 * 실제 데이터는 PlannerModule + DB가 채우지만, v1 화면 검수는 이 mock으로 진행한다.
 */
const TRIP_ID = 'demo-gyeongju-1n2d';
const HWANG_ITEM_ID = 'item-hwang-cafe';
const CHEOM_ITEM_ID = 'item-cheomseongdae';
const GYORI_ITEM_ID = 'item-gyori';
const BULGUKSA_ITEM_ID = 'item-bulguksa';

export const PLANNER_TRIP_MOCK: PlannerTripDto = {
  id: TRIP_ID,
  title: '경주 1박 2일',
  searchPlaceholder: '경주 여행 검색...',
  members: [
    { id: 'm1', initial: '태', color: '#3182F6' },
    { id: 'm2', initial: '박', color: '#6B7684' },
    { id: 'm3', initial: '홍', color: '#191F28' },
  ],
  mapCenter: { lat: 35.8347, lng: 129.2247, level: 7 },
  mapMarkers: [
    { id: 'mk1', itemId: CHEOM_ITEM_ID, label: '첨성대', order: 1, lat: 35.8347, lng: 129.2189, x: 0.18, y: 0.45, variant: 'primary' },
    { id: 'mk2', itemId: HWANG_ITEM_ID, label: '황리단길', order: 2, lat: 35.8392, lng: 129.2122, x: 0.5, y: 0.32, variant: 'primary' },
    { id: 'mk3', itemId: GYORI_ITEM_ID, label: '교리김밥', order: 3, lat: 35.835, lng: 129.2123, x: 0.45, y: 0.55, variant: 'primary' },
    { id: 'mk4', itemId: BULGUKSA_ITEM_ID, label: '불국사', order: 4, lat: 35.7898, lng: 129.332, x: 0.78, y: 0.58, variant: 'primary' },
  ],
  days: [
    { day: 1, label: '1일차', dateLabel: '5/17 토' },
    { day: 2, label: '2일차', dateLabel: '5/18 일' },
  ],
  meta: {
    startDate: '2026-05-17',
    endDate: '2026-05-18',
    durationLabel: '1박 2일 · 5/17 토 ~ 5/18 일',
    transportLabel: '대중교통',
    wakeTime: '07:30',
    sleepTime: '23:00',
    tasteTags: {
      food: ['한식', '카페'],
      mood: ['힐링', '로컬 탐방'],
      environment: ['도시', '골목'],
    },
    stats: {
      totalItems: 4,
      waitingCount: 2,
      estimatedTravelKm: 28,
    },
    weather: [
      { day: 1, label: '5/17 토 맑음', emoji: '☀️', tempLabel: '22°C / 12°C' },
      { day: 2, label: '5/18 일 구름 많음', emoji: '⛅', tempLabel: '19°C / 11°C' },
    ],
  },
  items: [
    {
      id: CHEOM_ITEM_ID,
      day: 1,
      scheduledAt: '09:00',
      type: 'attraction',
      typeLabel: '관광',
      name: '첨성대',
      durationLabel: '도보 20분',
      hasWaiting: false,
    },
    {
      id: HWANG_ITEM_ID,
      day: 1,
      scheduledAt: '10:30',
      type: 'cafe',
      typeLabel: '카페',
      name: '황리단길 카페',
      durationLabel: '1시간 30분',
      hasWaiting: true,
      waitingMinutes: 35,
    },
    {
      id: GYORI_ITEM_ID,
      day: 1,
      scheduledAt: '12:30',
      type: 'restaurant',
      typeLabel: '식사',
      name: '교리김밥 본점',
      durationLabel: '1시간',
      hasWaiting: true,
      waitingMinutes: 20,
    },
    {
      id: BULGUKSA_ITEM_ID,
      day: 1,
      scheduledAt: '14:30',
      type: 'attraction',
      typeLabel: '관광',
      name: '불국사',
      durationLabel: '2시간',
      hasWaiting: false,
    },
  ],
};

const ALTERNATIVE_MOCKS: Record<string, PlannerAlternativeResponseDto> = {
  [HWANG_ITEM_ID]: {
    itemId: HWANG_ITEM_ID,
    itemName: '황리단길 카페',
    waitingMinutes: 35,
    radiusMeters: 500,
    realtime: true,
    alternatives: [
      {
        id: 'alt-chalbori',
        categoryEmoji: '카',
        categoryTone: 'primary',
        name: '찰보리빵 카페',
        walkLabel: '도보 3분',
        waitLabel: '대기 없음',
        rating: 4.7,
        mapHref: 'https://map.kakao.com/?q=찰보리빵 카페',
        badge: '지금 바로',
        badgeTone: 'urgent',
      },
      {
        id: 'alt-cheonma',
        categoryEmoji: '카',
        categoryTone: 'neutral',
        name: '경주 천마총 카페',
        walkLabel: '도보 8분',
        waitLabel: '대기 10분',
        rating: 4.5,
        mapHref: 'https://map.kakao.com/?q=경주 천마총 카페',
        badge: '추천',
        badgeTone: 'recommend',
      },
      {
        id: 'alt-gyodong',
        categoryEmoji: '차',
        categoryTone: 'success',
        name: '교동 쌍화차 골목',
        walkLabel: '도보 5분',
        waitLabel: '대기 5분',
        rating: 4.4,
        mapHref: 'https://map.kakao.com/?q=교동 쌍화차 골목',
        badge: '현지 인기',
        badgeTone: 'local',
      },
    ],
    mapCenter: { lat: 35.8378, lng: 129.215, level: 4 },
    mapMarkers: [
      { id: 'mc', label: '황리단길 카페', order: 0, lat: 35.8392, lng: 129.2122, x: 0.22, y: 0.55, variant: 'current' },
      { id: 'ma1', label: '찰보리빵 카페', order: 1, lat: 35.8378, lng: 129.215, x: 0.55, y: 0.4, variant: 'alternative' },
      { id: 'ma2', label: '경주 천마총 카페', order: 2, lat: 35.8395, lng: 129.2125, x: 0.82, y: 0.55, variant: 'alternative' },
      { id: 'ma3', label: '교동 쌍화차 골목', order: 3, lat: 35.8316, lng: 129.22, x: 0.4, y: 0.75, variant: 'alternative' },
    ],
  },
  [CHEOM_ITEM_ID]: {
    itemId: CHEOM_ITEM_ID,
    itemName: '첨성대',
    waitingMinutes: 0,
    radiusMeters: 600,
    realtime: false,
    alternatives: [
      {
        id: 'alt-cheom-anapji',
        categoryEmoji: '관',
        categoryTone: 'primary',
        name: '안압지(동궁과 월지)',
        walkLabel: '도보 10분',
        waitLabel: '대기 없음',
        rating: 4.6,
        mapHref: 'https://map.kakao.com/?q=동궁과 월지',
        badge: '지금 바로',
        badgeTone: 'urgent',
      },
      {
        id: 'alt-cheom-daereungwon',
        categoryEmoji: '관',
        categoryTone: 'neutral',
        name: '대릉원',
        walkLabel: '도보 6분',
        waitLabel: '대기 없음',
        rating: 4.5,
        mapHref: 'https://map.kakao.com/?q=대릉원',
        badge: '추천',
        badgeTone: 'recommend',
      },
      {
        id: 'alt-cheom-gyochon',
        categoryEmoji: '관',
        categoryTone: 'success',
        name: '교촌마을',
        walkLabel: '도보 12분',
        waitLabel: '대기 없음',
        rating: 4.4,
        mapHref: 'https://map.kakao.com/?q=교촌마을',
        badge: '현지 인기',
        badgeTone: 'local',
      },
    ],
    mapCenter: { lat: 35.835, lng: 129.219, level: 4 },
    mapMarkers: [
      { id: 'mc', label: '첨성대', order: 0, lat: 35.8347, lng: 129.2189, x: 0.3, y: 0.5, variant: 'current' },
      { id: 'ma1', label: '안압지', order: 1, lat: 35.8347, lng: 129.225, x: 0.6, y: 0.4, variant: 'alternative' },
      { id: 'ma2', label: '대릉원', order: 2, lat: 35.8378, lng: 129.2125, x: 0.45, y: 0.3, variant: 'alternative' },
      { id: 'ma3', label: '교촌마을', order: 3, lat: 35.83, lng: 129.218, x: 0.35, y: 0.7, variant: 'alternative' },
    ],
  },
  [GYORI_ITEM_ID]: {
    itemId: GYORI_ITEM_ID,
    itemName: '교리김밥 본점',
    waitingMinutes: 20,
    radiusMeters: 400,
    realtime: true,
    alternatives: [
      {
        id: 'alt-gyori-ssambap',
        categoryEmoji: '식',
        categoryTone: 'primary',
        name: '경주쌈밥거리 함양집',
        walkLabel: '도보 4분',
        waitLabel: '대기 없음',
        rating: 4.6,
        mapHref: 'https://map.kakao.com/?q=함양집 경주',
        badge: '지금 바로',
        badgeTone: 'urgent',
      },
      {
        id: 'alt-gyori-haejangguk',
        categoryEmoji: '식',
        categoryTone: 'neutral',
        name: '경주 해장국집',
        walkLabel: '도보 7분',
        waitLabel: '대기 5분',
        rating: 4.4,
        mapHref: 'https://map.kakao.com/?q=경주 해장국집',
        badge: '추천',
        badgeTone: 'recommend',
      },
      {
        id: 'alt-gyori-noodle',
        categoryEmoji: '식',
        categoryTone: 'success',
        name: '경주 칼국수 노포',
        walkLabel: '도보 6분',
        waitLabel: '대기 10분',
        rating: 4.5,
        mapHref: 'https://map.kakao.com/?q=경주 칼국수',
        badge: '현지 인기',
        badgeTone: 'local',
      },
    ],
    mapCenter: { lat: 35.835, lng: 129.213, level: 4 },
    mapMarkers: [
      { id: 'mc', label: '교리김밥 본점', order: 0, lat: 35.835, lng: 129.2123, x: 0.3, y: 0.55, variant: 'current' },
      { id: 'ma1', label: '함양집', order: 1, lat: 35.834, lng: 129.215, x: 0.55, y: 0.45, variant: 'alternative' },
      { id: 'ma2', label: '해장국집', order: 2, lat: 35.837, lng: 129.212, x: 0.4, y: 0.3, variant: 'alternative' },
      { id: 'ma3', label: '칼국수 노포', order: 3, lat: 35.832, lng: 129.2105, x: 0.2, y: 0.7, variant: 'alternative' },
    ],
  },
  [BULGUKSA_ITEM_ID]: {
    itemId: BULGUKSA_ITEM_ID,
    itemName: '불국사',
    waitingMinutes: 0,
    radiusMeters: 1500,
    realtime: false,
    alternatives: [
      {
        id: 'alt-bulguk-seokguram',
        categoryEmoji: '관',
        categoryTone: 'primary',
        name: '석굴암',
        walkLabel: '셔틀 8분',
        waitLabel: '대기 없음',
        rating: 4.7,
        mapHref: 'https://map.kakao.com/?q=석굴암',
        badge: '지금 바로',
        badgeTone: 'urgent',
      },
      {
        id: 'alt-bulguk-tongiljeon',
        categoryEmoji: '관',
        categoryTone: 'neutral',
        name: '통일전',
        walkLabel: '차량 12분',
        waitLabel: '대기 없음',
        rating: 4.2,
        mapHref: 'https://map.kakao.com/?q=경주 통일전',
        badge: '추천',
        badgeTone: 'recommend',
      },
      {
        id: 'alt-bulguk-namsan',
        categoryEmoji: '관',
        categoryTone: 'success',
        name: '경주 남산 둘레길',
        walkLabel: '차량 15분',
        waitLabel: '대기 없음',
        rating: 4.6,
        mapHref: 'https://map.kakao.com/?q=경주 남산',
        badge: '현지 인기',
        badgeTone: 'local',
      },
    ],
    mapCenter: { lat: 35.79, lng: 129.33, level: 6 },
    mapMarkers: [
      { id: 'mc', label: '불국사', order: 0, lat: 35.7898, lng: 129.332, x: 0.4, y: 0.55, variant: 'current' },
      { id: 'ma1', label: '석굴암', order: 1, lat: 35.7951, lng: 129.348, x: 0.65, y: 0.4, variant: 'alternative' },
      { id: 'ma2', label: '통일전', order: 2, lat: 35.797, lng: 129.318, x: 0.3, y: 0.35, variant: 'alternative' },
      { id: 'ma3', label: '남산', order: 3, lat: 35.795, lng: 129.32, x: 0.25, y: 0.65, variant: 'alternative' },
    ],
  },
};

export function getPlannerTripMock(tripId: string): PlannerTripDto | undefined {
  if (tripId !== TRIP_ID) {
    return undefined;
  }
  return PLANNER_TRIP_MOCK;
}

export function getPlannerAlternativesMock(
  itemId: string,
): PlannerAlternativeResponseDto | undefined {
  return ALTERNATIVE_MOCKS[itemId];
}
