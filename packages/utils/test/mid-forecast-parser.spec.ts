/// <reference types="jest" />

import {
  parseMidWeather,
  parseMidTermForecast,
  getMidTmFc,
  tmFcToDate,
  type MidLandItem,
  type MidTaItem,
} from '../src/mid-forecast-parser';

describe('parseMidWeather', () => {
  it('맑음 → SKY 1, PTY 0', () => {
    expect(parseMidWeather('맑음')).toEqual({ skyCondition: 1, precipitationType: 0 });
  });

  it('구름많음 → SKY 3', () => {
    expect(parseMidWeather('구름많음').skyCondition).toBe(3);
  });

  it('흐리고 비 → SKY 4, PTY 1(비)', () => {
    expect(parseMidWeather('흐리고 비')).toEqual({ skyCondition: 4, precipitationType: 1 });
  });

  it('구름많고 비/눈 → PTY 2(비·눈)', () => {
    expect(parseMidWeather('구름많고 비/눈').precipitationType).toBe(2);
  });

  it('구름많고 소나기 → PTY 4(소나기)', () => {
    expect(parseMidWeather('구름많고 소나기').precipitationType).toBe(4);
  });

  it('흐리고 눈 → PTY 3(눈)', () => {
    expect(parseMidWeather('흐리고 눈').precipitationType).toBe(3);
  });
});

describe('parseMidTermForecast', () => {
  const base = tmFcToDate('202607140600'); // tmFc 기준일 2026-07-14 (UTC 자정)

  const land: MidLandItem = {
    wf3Am: '맑음',
    wf3Pm: '구름많음',
    rnSt3Am: 20,
    rnSt3Pm: 30,
    wf8: '흐리고 비',
    rnSt8: 70,
  };
  const ta: MidTaItem = {
    taMin3: 22,
    taMax3: 30,
    taMin8: 24,
    taMax8: 29,
  };

  it('3일차를 오전(09시)/오후(15시) 두 슬롯으로 전개하고 최저·최고기온을 채운다', () => {
    const map = parseMidTermForecast(land, ta, base);
    // day3 = 2026-07-17
    const am = map.get('20260717_0900')!;
    const pm = map.get('20260717_1500')!;

    expect(am.temperature).toBe(22);
    expect(am.minTemperature).toBe(22);
    expect(am.maxTemperature).toBe(30);
    expect(am.precipitationProbability).toBe(20);
    expect(am.skyCondition).toBe(1);

    expect(pm.temperature).toBe(30);
    expect(pm.precipitationProbability).toBe(30);
    expect(pm.skyCondition).toBe(3);
  });

  it('8~10일차는 12시 단일 슬롯으로 전개한다', () => {
    const map = parseMidTermForecast(land, ta, base);
    // day8 = 2026-07-22
    const slot = map.get('20260722_1200')!;
    expect(slot.precipitationProbability).toBe(70);
    expect(slot.precipitationType).toBe(1);
    expect(slot.maxTemperature).toBe(29);
  });

  it('minDay 로 앞부분(단기예보 겹침)을 잘라낸다', () => {
    const map = parseMidTermForecast(land, ta, base, 4);
    expect(map.has('20260717_0900')).toBe(false); // day3 제외
  });

  it('기온 item 이 없어도 강수/하늘상태만 채운다', () => {
    const map = parseMidTermForecast(land, undefined, base);
    const am = map.get('20260717_0900')!;
    expect(am.temperature).toBeUndefined();
    expect(am.precipitationProbability).toBe(20);
  });
});

describe('getMidTmFc', () => {
  it('06시 이전은 전날 18시 발표', () => {
    expect(getMidTmFc(new Date('2026-07-14T05:00:00+09:00'))).toBe('202607131800');
  });

  it('06~18시는 당일 06시 발표', () => {
    expect(getMidTmFc(new Date('2026-07-14T10:00:00+09:00'))).toBe('202607140600');
  });

  it('18시 이후는 당일 18시 발표', () => {
    expect(getMidTmFc(new Date('2026-07-14T20:00:00+09:00'))).toBe('202607141800');
  });

  it('서버 TZ 무관: 05시 KST(=전날 20시 UTC)도 전날 18시 발표', () => {
    expect(getMidTmFc(new Date('2026-07-13T20:00:00Z'))).toBe('202607131800');
  });
});

describe('tmFcToDate', () => {
  it('tmFc 날짜부를 UTC 자정 Date 로 파싱(서버 TZ 무관)', () => {
    const d = tmFcToDate('202607140600');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(6);
    expect(d.getUTCDate()).toBe(14);
  });
});
