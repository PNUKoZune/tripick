export const NOTIFICATION_SCHEDULER_QUEUE = 'notification-scheduler';

/** 트립 리마인더(D-1/D-day) 스캔 잡 이름 — 큐에 repeatable 로 1개만 등록된다. */
export const TRIP_REMINDER_SCAN_JOB = 'scan-trip-reminder';

/** 오래된 알림 정리 잡 이름 — 큐에 repeatable 로 1개만 등록된다. */
export const NOTIFICATION_ARCHIVE_JOB = 'archive-notifications';

/**
 * 리마인더 스캔 주기(cron, KST). 아침 9시에 하루 1회 — 출발 전날/당일 아침에
 * 한 번 알리면 충분하다. tz 를 KST 로 고정해야 UTC 컨테이너에서 9시간 밀리지 않는다.
 */
export const TRIP_REMINDER_CRON = '0 9 * * *';

/**
 * 아카이브 주기(cron, KST). 새벽 4시 — 트래픽이 적은 시간에 오래된 알림을 정리한다.
 * 리마인더 스캔(09:00)과 시간을 벌려 같은 인스턴스에서 겹치지 않게 한다.
 */
export const NOTIFICATION_ARCHIVE_CRON = '0 4 * * *';

/**
 * 알림 보존 기간(일). 읽은 지 이만큼 지난 알림만 정리한다.
 * 안 읽은 알림은 나이와 무관하게 남겨, 사용자가 못 본 알림을 잃지 않게 한다.
 */
export const NOTIFICATION_RETENTION_DAYS = 30;

/**
 * 반복 잡 등록 응답 대기 상한(ms). Redis 무응답 시 queue.add 는 던지지 않고
 * 오프라인 큐에 버퍼링되어 영영 안 끝나므로, 기다리지 않고 재시도로 넘긴다.
 */
export const SCHEDULE_REGISTER_TIMEOUT_MS = 10_000;

/** 등록 재시도 백오프 시작 간격(ms). 시도마다 2배로 늘어난다. */
export const SCHEDULE_RETRY_BASE_MS = 5_000;

/** 등록 재시도 백오프 상한(ms). 5분마다 계속 재시도한다. */
export const SCHEDULE_RETRY_MAX_MS = 5 * 60_000;

/**
 * 리마인더 중복 억제 키의 최소 TTL(초). 억제 기간은 "오늘(KST)이 끝날 때까지"로
 * 계산하며(dedupeTtlSec), 이 상수는 하루가 이미 끝나가는 경계에서만 쓰인다.
 */
export const MIN_DEDUPE_TTL_SEC = 60;
