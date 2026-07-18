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

/** 강수확률(POP) 이 이 값 이상이면 "비 올 것 같다" 로 본다. */
export const RAIN_PROBABILITY_THRESHOLD = 60;

/**
 * 하루치 슬롯 중 최소 이만큼이 강수여야 알림을 보낸다.
 * 새벽 한두 슬롯만 걸리는 경우까지 알리면 알림 피로가 크다.
 */
export const MIN_RAINY_SLOTS = 2;

/**
 * 같은 (여행, 일자) 조합 재알림 억제 기간(초). 24시간.
 * 예보가 3시간마다 갱신되지만 같은 비 예보로 하루에 8번 알릴 이유는 없다.
 */
export const ALERT_DEDUPE_TTL_SEC = 24 * 60 * 60;

/**
 * 비에 영향을 받는 일정 유형. restaurant·cafe·accommodation 은 실내이고
 * transport 는 이동 자체라, 관광지(attraction)가 있는 날만 알릴 가치가 있다.
 */
export const WEATHER_SENSITIVE_TYPES: ReadonlyArray<ItineraryItemType> = ['attraction'];
