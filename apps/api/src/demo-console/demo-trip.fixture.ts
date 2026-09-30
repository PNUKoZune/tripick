import type { ItineraryItemType } from '@tripick/types';

/** 시연용 여행 일정 1건의 원본 데이터. 시각은 "하루의 뼈대"로만 쓰고 실제 배치는 호출부가 정한다. */
export interface DemoPlace {
  /** 기준 시각(KST) — 항목 간 간격의 근거. 콘솔 시드는 이 간격을 유지한 채 통째로 옮긴다. */
  hour: number;
  minute: number;
  type: ItineraryItemType;
  name: string;
  address: string;
  lat: number;
  lng: number;
  durationMin: number;
}

/**
 * 시연용 당일 여행 일정.
 *
 * CLI 시드(`pnpm seed:demo-live`)와 시연 콘솔이 같은 데이터를 쓴다 — 두 경로가 다른 일정을
 * 만들면 무대에서 "화면과 다른 장소"가 나온다. 좌표는 실제 장소라 길찾기·날씨 조회가 그대로 돈다.
 */
export const DEMO_PLACES: DemoPlace[] = [
  { hour: 9, minute: 30, type: 'attraction', name: '성수 서울숲', address: '서울 성동구 뚝섬로 273', lat: 37.5446, lng: 127.0375, durationMin: 90 },
  { hour: 11, minute: 30, type: 'cafe', name: '성수 감도 카페', address: '서울 성동구 연무장길 45', lat: 37.5441, lng: 127.0541, durationMin: 60 },
  { hour: 13, minute: 30, type: 'restaurant', name: '을지로 한식 다이닝', address: '서울 중구 수표로 48', lat: 37.5667, lng: 126.9913, durationMin: 80 },
  { hour: 15, minute: 30, type: 'attraction', name: '국립중앙박물관', address: '서울 용산구 서빙고로 137', lat: 37.523, lng: 126.9804, durationMin: 90 },
  { hour: 17, minute: 30, type: 'attraction', name: '한강 노들섬', address: '서울 용산구 양녕로 445', lat: 37.5177, lng: 126.9574, durationMin: 70 },
  { hour: 19, minute: 30, type: 'restaurant', name: '북촌 골목 한정식', address: '서울 종로구 계동길 37', lat: 37.5826, lng: 126.9831, durationMin: 80 },
];

/** 하루 중 자정 기준 분. */
function minutesOfDay(place: DemoPlace): number {
  return place.hour * 60 + place.minute;
}

/** 기준 시각 그대로(KST)의 절대 시각. 로컬 TZ Date 생성자를 쓰면 UTC 서버에서 시각이 밀린다. */
export function clockScheduledAt(place: DemoPlace, isoDate: string): Date {
  const hh = String(place.hour).padStart(2, '0');
  const mm = String(place.minute).padStart(2, '0');
  return new Date(`${isoDate}T${hh}:${mm}:00+09:00`);
}

/**
 * 지금 시각에 맞춰 하루를 통째로 옮긴 일정 시각표를 만든다.
 *
 * 시연은 아무 때나 시작되는데 고정 시각표를 쓰면 발표 시점에 "지금 진행 중인 일정"도,
 * 미도착 판정 창에 든 항목도 없을 수 있다. 그래서 `anchorAt` 에 놓을 항목(`anchorIndex`)을
 * 정하고 나머지는 원래 간격을 유지한 채 함께 민다 — 일정의 순서·간격은 그대로라 화면상
 * 하루가 자연스럽게 보이고, 기준 항목만 원하는 판정 창에 들어간다.
 *
 * @returns DEMO_PLACES 와 같은 순서의 절대 시각 배열
 */
export function shiftedSchedule(anchorIndex: number, anchorAt: Date): Date[] {
  const base = minutesOfDay(DEMO_PLACES[anchorIndex]!);
  return DEMO_PLACES.map(
    (place) => new Date(anchorAt.getTime() + (minutesOfDay(place) - base) * 60_000),
  );
}

/** 기준 시각표에서 주어진 시각(KST 기준 분)에 가장 가까운 항목의 인덱스. */
export function nearestPlaceIndex(minutesFromMidnightKst: number): number {
  let best = 0;
  let bestGap = Number.POSITIVE_INFINITY;
  DEMO_PLACES.forEach((place, index) => {
    const gap = Math.abs(minutesOfDay(place) - minutesFromMidnightKst);
    if (gap < bestGap) {
      best = index;
      bestGap = gap;
    }
  });
  return best;
}
