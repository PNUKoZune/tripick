/**
 * 경로 조회 교통수단. car=자동차, transit=대중교통(+도보), walk=도보 전용.
 * TripEntity.transportMode 와 동일한 값 집합 — 표시용 라벨에서 역추론하지 말 것.
 */
export type RouteTransportMode = 'car' | 'transit' | 'walk';

/** 두 좌표 간 경로 ETA 결과 (OTP 조회, 실패 시 서버가 직선거리 추정으로 폴백). */
export interface RouteEtaDto {
  /** 예상 소요 시간(초) */
  durationSec: number;
  /** 경로 총 거리(m) */
  distanceM: number;
}
