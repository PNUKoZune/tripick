import type { ItineraryItemType } from '@tripick/types';

export const WEATHER_ALERT_QUEUE = 'weather-alert';

/** 반복 스캔 잡 이름 — 큐에 repeatable 로 1개만 등록된다. */
export const WEATHER_ALERT_SCAN_JOB = 'scan-weather';

/**
 * 스캔 주기(cron). 기상청 단기예보 발표(02·05·08·11·14·17·20·23시) 직후를 노려
 * 발표 10분 뒤 정각에 돌린다 — 갱신된 예보를 바로 반영하면서 캐시도 재사용한다.
 */
export const WEATHER_ALERT_CRON = '10 2,5,8,11,14,17,20,23 * * *';

/** 예보로 커버되는 최대 일수(단기 ~3일 + 중기 ~10일). 이 밖의 여행일은 스캔하지 않는다. */
export const FORECAST_HORIZON_DAYS = 10;

/**
 * 반복 잡 등록 응답 대기 상한(ms). Redis 무응답 시 queue.add 는 던지지 않고
 * 오프라인 큐에 버퍼링되어 영영 안 끝나므로, 기다리지 않고 재시도로 넘긴다.
 */
export const SCHEDULE_REGISTER_TIMEOUT_MS = 10_000;

/** 등록 재시도 백오프 시작 간격(ms). 시도마다 2배로 늘어난다. */
export const SCHEDULE_RETRY_BASE_MS = 5_000;

/** 등록 재시도 백오프 상한(ms). 5분마다 계속 재시도한다. */
export const SCHEDULE_RETRY_MAX_MS = 5 * 60_000;

/** 여행 일자 순회 상한 — endDate 가 깨진 데이터여도 루프가 발산하지 않게 하는 안전장치. */
export const MAX_TRIP_DAYS = 366;

/** 강수확률(POP) 이 이 값 이상이면 "비 올 것 같다" 로 본다. */
export const RAIN_PROBABILITY_THRESHOLD = 60;

/**
 * 하루치 슬롯 중 최소 이만큼이 강수여야 알림을 보낸다.
 * 새벽 한두 슬롯만 걸리는 경우까지 알리면 알림 피로가 크다.
 */
export const MIN_RAINY_SLOTS = 2;

/**
 * 중복 억제 키의 최소 TTL(초).
 *
 * 억제 기간은 고정값이 아니라 "대상 날짜가 KST 로 끝날 때까지" 로 계산한다
 * (dedupeTtlSec). 같은 (여행, 일자) 알림은 평생 1회만 나가므로, 사용자가 일정을
 * 바꾸든 그대로 두든 같은 날짜로 다시 알리지 않는다.
 *
 * 24시간 고정이던 시절엔 날짜가 올 때까지 매일 재알림이 나가, 5일 전 시작한
 * 4일 여행이면 알림이 10건 넘게 쌓였다.
 *
 * 이 상수는 대상 날짜가 이미 끝나가는 경계(EX 가 0 이하로 계산되는 경우)에서만 쓰인다.
 */
export const MIN_DEDUPE_TTL_SEC = 60;

/**
 * 비에 영향을 받는 일정 유형. restaurant·cafe·accommodation 은 실내이고
 * transport 는 이동 자체라, 관광지(attraction)가 있는 날만 알릴 가치가 있다.
 */
export const WEATHER_SENSITIVE_TYPES: ReadonlyArray<ItineraryItemType> = ['attraction'];
