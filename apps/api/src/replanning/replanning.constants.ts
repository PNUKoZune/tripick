export const REPLAN_QUEUE = 'replan';
export const REPLAN_JOB = 'replan-job';

/**
 * 서버가 자동 주입하는 현재 위치를 인정하는 최대 거리(m) — 재계획 대상 일차 장소 중
 * 가장 가까운 곳까지의 거리 기준.
 *
 * 카카오 키워드 검색 기본 반경(`KAKAO_SEARCH_RADIUS_M`=20km)을 사용자 위치에 걸어도 그 일차
 * 장소들과 후보 풀이 겹치는 범위에 광역시 규모 이동 여유를 더한 값이다. 이보다 멀면
 * "지금 위치에 맞춰"의 전제(여행지 안에 있다)가 깨져 앵커가 후보를 딴 지역으로 끌고 간다.
 */
export const REPLAN_LOCATION_MAX_DISTANCE_M = 30_000;
