import type { ItineraryItemType } from '@tripick/types';

export const CROWD_ALERT_QUEUE = 'crowd-alert';

/** 반복 스캔 잡 이름 — 큐에 repeatable 로 1개만 등록된다. */
export const CROWD_ALERT_SCAN_JOB = 'scan-crowd';

/**
 * 스캔 주기(cron). 집중률은 향후 30일 예측이라 자주 볼 이유가 없어 하루 1회(새벽) 돈다.
 * 날씨 스캔(발표 시각 연동, 8회/일)과 달리 갱신 트리거가 없으므로 저빈도로 충분하다.
 */
export const CROWD_ALERT_CRON = '30 3 * * *';

/** 집중률 예측이 커버하는 최대 일수. 이 밖의 여행일은 스캔하지 않는다(데이터도 없다). */
export const CONCENTRATION_HORIZON_DAYS = 27;

/**
 * 반복 잡 등록 응답 대기 상한(ms). Redis 무응답 시 queue.add 는 던지지 않고
 * 오프라인 큐에 버퍼링되어 영영 안 끝나므로, 기다리지 않고 재시도로 넘긴다.
 */
export const SCHEDULE_REGISTER_TIMEOUT_MS = 10_000;

/** 등록 재시도 백오프 시작 간격(ms). 시도마다 2배로 늘어난다. */
export const SCHEDULE_RETRY_BASE_MS = 5_000;

/** 등록 재시도 백오프 상한(ms). */
export const SCHEDULE_RETRY_MAX_MS = 5 * 60_000;

/** 여행 일자 순회 상한 — endDate 가 깨진 데이터여도 루프가 발산하지 않게 하는 안전장치. */
export const MAX_TRIP_DAYS = 366;

/**
 * 1회 혼잡 스캔이 쓸 수 있는 KTO 집중률 호출 상한(관광지당 1콜).
 * KTO 일일 한도(1000)를 적재 파이프라인과 나눠 쓰므로, 스캔이 한도를 독점하지 않게 선제 캡한다.
 * 반응형 쿼터 감지(초과 응답 시 중단)의 백업이자, 그보다 먼저 걸리는 예산이다. 초기값이며 튜닝 대상.
 */
export const CROWD_SCAN_CALL_BUDGET = 300;

/** 중복 억제 키의 최소 TTL(초). 실제 억제는 "대상 날짜가 KST 로 끝날 때까지"로 계산한다. */
export const MIN_DEDUPE_TTL_SEC = 60;

/**
 * "혼잡" 판정 임계 — 두 조건을 모두 만족해야 알린다.
 * 1) 그 관광지 예측 기간 평균 대비 CROWD_RELATIVE_MULTIPLIER 배 이상 (그 장소 기준 붐비는 날)
 * 2) 절대 집중률이 CROWD_MIN_RATE 이상 (평소 한산한 곳이 살짝 오른 것까지 알리지 않도록)
 *
 * 집중률(cnctrRate)의 절대 스케일은 관광지마다 다르므로 상대 기준을 우선한다.
 * 두 값은 현장 데이터로 캘리브레이션이 필요한 초기값이다.
 */
export const CROWD_RELATIVE_MULTIPLIER = 1.2;
export const CROWD_MIN_RATE = 10;

/**
 * 혼잡 알림 대상 일정 유형. 집중률 API 자체가 관광지(attraction)만 제공하므로
 * 음식점·카페·숙박·이동은 대상이 아니다.
 */
export const CROWD_SENSITIVE_TYPES: ReadonlyArray<ItineraryItemType> = ['attraction'];
