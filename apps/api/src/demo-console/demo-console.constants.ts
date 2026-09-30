/**
 * 시연 콘솔 상수.
 *
 * 이 모듈은 발표 시연에서 "조건"을 주입하는 보조 도구다 — 값들은 무대에서 버튼 한 번에
 * 알림이 나게 만드는 데 필요한 최소 설정이며, 운영 판정 임계값은 각 알림 모듈 상수를 그대로 쓴다.
 */

/** 시연 콘솔 라우트 등록 여부를 결정하는 env 키. 'true' 일 때만 모듈이 붙는다. */
export const DEMO_CONSOLE_ENABLED_ENV = 'DEMO_CONSOLE_ENABLED';

/** 콘솔을 쓸 수 있는 계정 이메일 목록(쉼표 구분) env 키. 프로덕션에서는 필수. */
export const DEMO_CONSOLE_EMAILS_ENV = 'DEMO_CONSOLE_EMAILS';

/** 시연용 여행 제목 — 재실행 시 이 제목의 기존 여행을 지우고 다시 만든다(멱등). */
export const DEMO_TRIP_TITLE = '성수·한강 당일 여행 (데모)';

/** 미도착 시나리오에서 주입하는 기본 이탈 거리(km). 도착 반경(500m)보다 충분히 멀다. */
export const DEFAULT_DEVIATION_KM = 3;

/** 주입 위치의 GPS 정확도(m). 판정이 `거리 - 정확도` 로 보므로 작게 잡아야 이탈로 잡힌다. */
export const INJECTED_ACCURACY_M = 20;

/**
 * 미도착 판정 창 안쪽으로 얼마나 들어가게 시각을 맞출지(분).
 * 항목 시각 = 지금 - (유예 + 이 값) 이라, 스캔이 곧바로 "시작+유예를 지난 항목"으로 집어간다.
 */
export const DUE_WINDOW_MARGIN_MIN = 5;

/** 혼잡 시나리오가 주입하는 집중률 — 평소치와 대상일치. 상대 임계(평균×1.2)를 넘게 잡는다. */
export const DEMO_CROWD_BASELINE_RATE = 18;
export const DEMO_CROWD_PEAK_RATE = 62;

/** 혼잡 시계열을 만들 기간(일). 평균 산출이 한쪽 값에 쏠리지 않을 정도면 충분하다. */
export const DEMO_CROWD_SERIES_DAYS = 14;

/** 날씨 시나리오가 주입하는 강수확률(%)·강수형태(1=비). 판정 임계를 확실히 넘긴다. */
export const DEMO_RAIN_PROBABILITY = 80;
export const DEMO_RAIN_TYPE = 1;

/** 비 예보를 넣을 시간대 — 판정이 요구하는 최소 강수 슬롯 수를 넉넉히 넘긴다. */
export const DEMO_RAIN_HOURS = ['0900', '1200', '1500', '1800'] as const;

/**
 * 시연 전용 스캐너 인스턴스 DI 토큰.
 *
 * 정기 스캔이 쓰는 인스턴스와 클래스는 같고 **바깥 데이터 대역만 다른** 인스턴스를 따로 만든다
 * (기상청·KTO 대신 DemoForecastSource·DemoConcentrationSource). 운영 인스턴스를 건드리지 않으려는
 * 것이며, 판정·발송 로직은 양쪽 모두 같은 코드다.
 */
export const DEMO_WEATHER_ALERT = Symbol('DEMO_WEATHER_ALERT');
export const DEMO_CROWD_ALERT = Symbol('DEMO_CROWD_ALERT');
