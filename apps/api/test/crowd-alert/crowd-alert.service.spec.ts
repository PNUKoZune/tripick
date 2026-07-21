/// <reference types="jest" />

import { Logger } from '@nestjs/common';
import { CrowdAlertService } from '../../src/crowd-alert/crowd-alert.service';
import type { ConcentrationLookup } from '../../src/planner/retrieval/tats-cnctr-rate.service';

// 호출 예산 소진(budget_exhausted)을 소수의 관광지로 결정적으로 재현하려고 예산을 작게 줄인다.
// 나머지 상수는 실제 값을 그대로 쓴다.
jest.mock('../../src/crowd-alert/crowd-alert.constants', () => ({
  ...jest.requireActual('../../src/crowd-alert/crowd-alert.constants'),
  CROWD_SCAN_CALL_BUDGET: 5,
}));

// ioredis 는 실제 연결 없이 동작하도록 인메모리 스텁으로 대체한다(SET NX 흉내).
const redisStore = new Map<string, string>();
const mockRedisSet = jest.fn(async (key: string, value: string, ...args: unknown[]) => {
  if (args.includes('NX') && redisStore.has(key)) return null;
  redisStore.set(key, value);
  return 'OK';
});
jest.mock('ioredis', () => ({
  Redis: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    set: mockRedisSet,
  })),
}));

// KST 07-18. 여행(07-19)은 예측 구간 안.
const NOW = new Date('2026-07-18T00:00:00Z');

function config() {
  return { get: <T>(_key: string, def?: T) => def } as any;
}

function trip(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trip-1',
    title: '경주 여행',
    status: 'confirmed',
    startDate: '2026-07-19',
    endDate: '2026-07-19',
    ...overrides,
  } as any;
}

/** 07-19 하루 일정의 관광지 항목. */
function attraction(name: string, address = '경상북도 경주시') {
  return { tripId: 'trip-1', day: 1, type: 'attraction', name, address } as any;
}

/** 붐비지 않는(=알림 미발송) 시계열 — 커버리지 집계만 검증하려는 목적. */
function calmSeries(name: string): ConcentrationLookup {
  return { ok: true, series: { tAtsNm: name, ratesByYmd: new Map([['20260719', 5]]), mean: 5 } };
}

function build(opts: {
  items: any[];
  resolveRegion?: (address: string) => { areaCd: string; signguCd: string } | null;
  lookup?: (name: string) => ConcentrationLookup;
}) {
  const tripsRepo = { find: jest.fn(async () => [trip()]) } as any;
  const itemsRepo = { find: jest.fn(async () => opts.items) } as any;
  const tatsCnctrRate = {
    resolveRegionCode: jest.fn(async (address: string) =>
      opts.resolveRegion ? opts.resolveRegion(address) : { areaCd: '47', signguCd: '47130' },
    ),
    fetchConcentration: jest.fn(
      async (_a: string, _s: string, name: string): Promise<ConcentrationLookup> =>
        opts.lookup ? opts.lookup(name) : calmSeries(name),
    ),
  } as any;
  const inboxService = { create: jest.fn(async () => ({ id: 'n1' })) } as any;
  const tripMembersService = {
    getNotificationTargets: jest.fn(async () => ({ tripTitle: '경주 여행', userIds: ['u1'] })),
  } as any;

  const service = new CrowdAlertService(
    tripsRepo,
    itemsRepo,
    tatsCnctrRate,
    inboxService,
    tripMembersService,
    config(),
  );
  return { service, tatsCnctrRate, inboxService };
}

/** 스캔 후 남은 커버리지 요약 로그(warn 또는 log)를 뽑는다. */
function coverageLine(warn: jest.SpyInstance, log: jest.SpyInstance): string | undefined {
  const all = [...warn.mock.calls, ...log.mock.calls].map((c) => String(c[0]));
  return all.find((line) => line.includes('커버리지'));
}

describe('CrowdAlertService 커버리지 지표', () => {
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    redisStore.clear();
    jest.clearAllMocks();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('모든 관광지가 매칭되면 스킵 0, 요약은 warn 이 아닌 log 로 남긴다', async () => {
    const { service } = build({ items: [attraction('불국사'), attraction('석굴암')] });

    await service.scanUpcomingTrips(NOW);

    const line = coverageLine(warnSpy, logSpy);
    expect(line).toContain('매칭 2');
    expect(line).toContain('스킵 0');
    // 스킵이 없으므로 커버리지 요약은 warn 으로 올라오지 않는다.
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('커버리지'))).toBe(false);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('커버리지'))).toBe(true);
  });

  it('사유별로 스킵을 집계하고, 스킵이 있으면 warn 으로 올린다', async () => {
    const { service } = build({
      items: [
        attraction('불국사'), // 매칭
        attraction('무명관광지', '서울특별시 강남구'), // region_unresolved
        attraction('첨성대'), // name_mismatch
        attraction('경주월드'), // no_data
        attraction('동궁과월지'), // empty_rate
      ],
      resolveRegion: (address) =>
        address.startsWith('경상북도') ? { areaCd: '47', signguCd: '47130' } : null,
      lookup: (name) => {
        if (name === '불국사') return calmSeries(name);
        if (name === '첨성대') return { ok: false, reason: 'name_mismatch' };
        if (name === '경주월드') return { ok: false, reason: 'no_data' };
        if (name === '동궁과월지') return { ok: false, reason: 'empty_rate' };
        return calmSeries(name);
      },
    });

    await service.scanUpcomingTrips(NOW);

    const line = coverageLine(warnSpy, logSpy);
    expect(line).toBeDefined();
    expect(line).toContain('매칭 1');
    expect(line).toContain('스킵 4');
    expect(line).toContain('region_unresolved 1');
    expect(line).toContain('name_mismatch 1');
    expect(line).toContain('no_data 1');
    expect(line).toContain('empty_rate 1');
    // 스킵이 있으므로 warn 으로 올라온다.
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('커버리지'))).toBe(true);
  });

  it('region_unresolved 는 KTO 를 호출하지 않는다(예산 절약)', async () => {
    const { service, tatsCnctrRate } = build({
      items: [attraction('무명관광지', '서울특별시 강남구')],
      resolveRegion: () => null,
    });

    await service.scanUpcomingTrips(NOW);

    expect(tatsCnctrRate.fetchConcentration).not.toHaveBeenCalled();
    expect(coverageLine(warnSpy, logSpy)).toContain('region_unresolved 1');
  });

  it('호출 예산을 넘긴 관광지는 budget_exhausted 로 집계된다', async () => {
    // 예산 5 → 6번째 관광지는 조회 전에 예산 소진.
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => attraction(n));
    const { service, tatsCnctrRate } = build({ items });

    await service.scanUpcomingTrips(NOW);

    // 예산만큼만 실제 조회한다.
    expect(tatsCnctrRate.fetchConcentration).toHaveBeenCalledTimes(5);
    const line = coverageLine(warnSpy, logSpy);
    expect(line).toContain('매칭 5');
    expect(line).toContain('budget_exhausted 1');
  });
});
