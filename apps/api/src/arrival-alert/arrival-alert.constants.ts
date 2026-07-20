export const ARRIVAL_ALERT_QUEUE = 'arrival-alert';

/** 반복 스캔 잡 이름 — 큐에 repeatable 로 1개만 등록된다. */
export const ARRIVAL_ALERT_SCAN_JOB = 'scan-arrival';

/**
 * 스캔 주기(cron). 일정 시작 시각을 놓치지 않으려면 유예(ARRIVAL_GRACE_MIN)보다 촘촘해야 한다.
 * 5분마다 돌며, 각 항목은 "시작+유예"를 지난 뒤 첫 스캔에서 판정된다(중복은 dedup 으로 억제).
 */
export const ARRIVAL_ALERT_CRON = '*/5 * * * *';

/**
 * 도착 인정 유예(분). 일정 시작 시각 정각이 아니라 이만큼 지난 뒤에도 근처에 없어야 "미도착".
 * 신호·주차·도보 접근 등을 감안한 값이며 캘리브레이션 대상.
 */
export const ARRIVAL_GRACE_MIN = 15;

/**
 * 도착 인정 반경(m). 현재 위치가 항목 좌표에서 이 거리 안이면 "도착"으로 본다.
 * GPS 오차·주차장·넓은 관광지 부지를 흡수하는 값이며 캘리브레이션 대상.
 */
export const ARRIVAL_RADIUS_M = 500;

/**
 * "시작+유예"를 지나도 이 시간(분)까지만 판정 대상. 이보다 더 늦은 항목은 사용자가 이미
 * 그 일정을 접었다고 보고 알리지 않는다(뒤늦은 알림은 잡음).
 */
export const ARRIVAL_LATE_LIMIT_MIN = 60;

/**
 * 위치 신선도 상한(ms). 마지막 위치 보고가 이보다 오래됐으면 판정을 건너뛴다
 * (GPS 꺼짐·실내·앱 백그라운드). 오탐(위치를 모르면서 미도착 처리)을 막는다.
 */
export const LOCATION_STALE_MS = 10 * 60_000;

/** 서버가 보관하는 실시간 위치 캐시 TTL(초). 신선도 상한보다 여유를 둔다. */
export const LOCATION_TTL_SEC = 15 * 60;

/**
 * 미도착 알림 중복 억제 TTL(초). (여행, 사용자, 일차)당 1회만 보내, 하루 여러 항목을 놓쳐도
 * 알림이 도배되지 않게 한다. 남은 일정 시간을 덮을 만큼(6시간)이면 충분하고 자동 만료된다.
 */
export const ARRIVAL_DEDUPE_TTL_SEC = 6 * 60 * 60;

/**
 * 반복 잡 등록 응답 대기 상한(ms). Redis 무응답 시 queue.add 는 던지지 않고
 * 오프라인 큐에 버퍼링되어 영영 안 끝나므로, 기다리지 않고 재시도로 넘긴다.
 */
export const SCHEDULE_REGISTER_TIMEOUT_MS = 10_000;

/** 등록 재시도 백오프 시작 간격(ms). 시도마다 2배로 늘어난다. */
export const SCHEDULE_RETRY_BASE_MS = 5_000;

/** 등록 재시도 백오프 상한(ms). */
export const SCHEDULE_RETRY_MAX_MS = 5 * 60_000;
