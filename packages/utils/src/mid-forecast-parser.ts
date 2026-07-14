/**
 * 기상청 중기예보(중기육상예보·중기기온) 응답 파싱 유틸
 *
 * 단기예보(~3일)를 넘어 +3~+10일 예보를 채우기 위한 변환기.
 * 중기예보는 시간대별이 아니라 "일자 + 오전/오후" 단위라, 단기예보와 동일한
 * ParsedForecast(시간슬롯) 형태로 합성해 소비 측(주간 날씨 카드·강수 힌트)이
 * 단기·중기를 구분 없이 다룰 수 있게 한다.
 *
 * - getMidLandFcst: 3~7일은 오전/오후(Am/Pm) 강수확률·날씨, 8~10일은 하루 단위
 * - getMidTa      : 3~10일 최저/최고기온
 *
 * @see https://www.data.go.kr/data/15059468/openapi.do
 */

import { getKstParts } from './date';
import type { ParsedForecast } from './weather-parser';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** getMidLandFcst 응답의 item (동적 dayN 필드) */
export type MidLandItem = Record<string, string | number | undefined>;

/** getMidTa 응답의 item (동적 dayN 필드) */
export type MidTaItem = Record<string, string | number | undefined>;

/**
 * 중기예보 날씨 텍스트(wf) → 하늘상태(SKY)·강수형태(PTY) 근사 변환.
 *
 * 중기예보 wf 는 "맑음", "구름많음", "흐리고 비", "구름많고 눈",
 * "흐리고 비/눈", "구름많고 소나기" 등 문자열로 온다.
 * 단기예보와 동일한 SKY/PTY 코드로 정규화해 describeWeather 등에서 재사용한다.
 *
 * SKY: 1 맑음 / 3 구름많음 / 4 흐림
 * PTY: 0 없음 / 1 비 / 2 비·눈 / 3 눈 / 4 소나기
 */
export function parseMidWeather(wf: string): {
  skyCondition: number;
  precipitationType: number;
} {
  const text = wf.trim();

  let precipitationType = 0;
  if (/비\/눈|눈\/비|비.*눈|눈.*비/.test(text)) precipitationType = 2;
  else if (text.includes('소나기')) precipitationType = 4;
  else if (text.includes('눈')) precipitationType = 3;
  else if (text.includes('비')) precipitationType = 1;

  let skyCondition = 1;
  if (text.includes('흐림') || text.includes('흐리')) skyCondition = 4;
  else if (text.includes('구름많')) skyCondition = 3;
  else if (text.includes('맑음')) skyCondition = 1;
  // 텍스트에 하늘상태가 명시되지 않고 강수만 있으면 흐린 것으로 간주
  else if (precipitationType > 0) skyCondition = 4;

  return { skyCondition, precipitationType };
}

/** 숫자로 파싱 가능한 값만 number 로, 아니면 undefined */
function num(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * base(발표일을 담은 Date) 기준 dayOffset 일 뒤의 YYYYMMDD.
 * tmFcToDate 가 UTC 자정으로 만든 Date 를 UTC 정수 연산으로만 다뤄
 * 서버 타임존과 무관하게 캘린더 날짜만 계산한다.
 */
function shiftKmaDate(base: Date, dayOffset: number): string {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

/**
 * 중기육상예보 + 중기기온 item → 일자별 ParsedForecast 맵.
 *
 * @param land   getMidLandFcst 의 item (없으면 강수/하늘상태는 비움)
 * @param ta     getMidTa 의 item (없으면 기온은 비움)
 * @param tmFcDate 발표 기준일(tmFc 날짜). dayN 은 이 날짜 + N 일로 매핑된다.
 * @param minDay 채울 시작 일수(기본 3). 단기예보와 겹치는 앞부분을 잘라낼 때 사용.
 */
export function parseMidTermForecast(
  land: MidLandItem | undefined,
  ta: MidTaItem | undefined,
  tmFcDate: Date,
  minDay = 3,
): Map<string, ParsedForecast> {
  const map = new Map<string, ParsedForecast>();

  const put = (
    date: string,
    time: string,
    fields: Partial<ParsedForecast>,
  ): void => {
    const key = `${date}_${time}`;
    const existing = map.get(key) ?? { date, time };
    map.set(key, { ...existing, ...fields });
  };

  for (let day = Math.max(minDay, 3); day <= 10; day++) {
    const date = shiftKmaDate(tmFcDate, day);
    const taMin = ta ? num(ta[`taMin${day}`]) : undefined;
    const taMax = ta ? num(ta[`taMax${day}`]) : undefined;
    const tempFields: Partial<ParsedForecast> = {};
    if (taMin !== undefined) tempFields.minTemperature = taMin;
    if (taMax !== undefined) tempFields.maxTemperature = taMax;

    if (day <= 7) {
      // 오전(대표시각 09시, 기온=최저) / 오후(대표시각 15시, 기온=최고)
      const amWf = land?.[`wf${day}Am`];
      const pmWf = land?.[`wf${day}Pm`];
      const amPop = land ? num(land[`rnSt${day}Am`]) : undefined;
      const pmPop = land ? num(land[`rnSt${day}Pm`]) : undefined;

      const am: Partial<ParsedForecast> = { ...tempFields };
      if (taMin !== undefined) am.temperature = taMin;
      if (amPop !== undefined) am.precipitationProbability = amPop;
      if (typeof amWf === 'string') Object.assign(am, parseMidWeather(amWf));
      put(date, '0900', am);

      const pm: Partial<ParsedForecast> = { ...tempFields };
      if (taMax !== undefined) pm.temperature = taMax;
      if (pmPop !== undefined) pm.precipitationProbability = pmPop;
      if (typeof pmWf === 'string') Object.assign(pm, parseMidWeather(pmWf));
      put(date, '1500', pm);
    } else {
      // 8~10일: 하루 단위 단일 슬롯(대표시각 12시)
      const wf = land?.[`wf${day}`];
      const pop = land ? num(land[`rnSt${day}`]) : undefined;

      const slot: Partial<ParsedForecast> = { ...tempFields };
      if (taMax !== undefined) slot.temperature = taMax;
      else if (taMin !== undefined) slot.temperature = taMin;
      if (pop !== undefined) slot.precipitationProbability = pop;
      if (typeof wf === 'string') Object.assign(slot, parseMidWeather(wf));
      put(date, '1200', slot);
    }
  }

  return map;
}

/**
 * 중기예보 발표시각(tmFc) 계산 (Asia/Seoul 기준). 발표는 매일 06시·18시.
 * 서버 타임존과 무관하게 KST 로 가장 최근 확정 발표시각을 고른다.
 *
 * @returns "YYYYMMDD0600" | "YYYYMMDD1800"
 */
export function getMidTmFc(now: Date = new Date()): string {
  const { year, month, day, hour } = getKstParts(now);
  const today = `${year}${pad2(month)}${pad2(day)}`;

  if (hour < 6) {
    // 06시 발표 전 → 전날 18시 발표
    const prev = new Date(Date.UTC(year, month - 1, day));
    prev.setUTCDate(prev.getUTCDate() - 1);
    return `${prev.getUTCFullYear()}${pad2(prev.getUTCMonth() + 1)}${pad2(prev.getUTCDate())}1800`;
  }
  if (hour < 18) {
    return `${today}0600`;
  }
  return `${today}1800`;
}

/**
 * tmFc 문자열("YYYYMMDD0600")의 날짜 부분을 UTC 자정 Date 로 파싱.
 * shiftKmaDate 가 UTC 정수 연산으로 dayN 날짜를 계산하도록 UTC 기준으로 만든다.
 */
export function tmFcToDate(tmFc: string): Date {
  const y = Number(tmFc.slice(0, 4));
  const m = Number(tmFc.slice(4, 6));
  const d = Number(tmFc.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d));
}
