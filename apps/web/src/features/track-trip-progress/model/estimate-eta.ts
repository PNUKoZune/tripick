/**
 * 다음 장소까지의 직선 거리(m)와 이동수단으로 도착 예상 시간을 대략 추정한다.
 * 실제 경로 ETA(route.helper)는 GPS 틱마다 호출하기 무거우므로, Live 화면에선
 * 표시용 "약 N분" 근사치만 클라에서 계산한다.
 */

/** 이동수단별 평균 속도 (m/min). 대기·신호 등을 감안한 보수적 값. */
const SPEED_M_PER_MIN = {
  walk: 75, // 약 4.5km/h
  transit: 250, // 약 15km/h (대기 포함)
  car: 400, // 약 24km/h (도심)
} as const;

function speedFor(transportLabel?: string): number {
  if (!transportLabel) return SPEED_M_PER_MIN.transit;
  if (transportLabel.includes('도보') || transportLabel.includes('걷')) return SPEED_M_PER_MIN.walk;
  if (transportLabel.includes('차') || transportLabel.includes('자동차')) return SPEED_M_PER_MIN.car;
  return SPEED_M_PER_MIN.transit;
}

/** 거리(m) → 예상 소요 분. 최소 1분. */
export function estimateEtaMinutes(distanceM: number, transportLabel?: string): number {
  return Math.max(1, Math.round(distanceM / speedFor(transportLabel)));
}

/** 거리(m) → "850m" / "1.2km" 표시 문구. */
export function formatDistance(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM)}m`;
  return `${(distanceM / 1000).toFixed(1)}km`;
}
