/// <reference types="jest" />

import { PlannerService } from '../../src/planner/planner.service';
import type { CandidatePlace } from '../../src/planner/retrieval/types';
import type { CreateItineraryItemDto, ItineraryItemDto } from '@tripick/types';

/** 2026-08-03 15:00 KST — 하루가 이미 절반 지난 시각. */
const NOW = new Date('2026-08-03T06:00:00Z');
/** 여행 1일차 = 오늘. */
const TODAY = '2026-08-03';

/** KST "HH:MM" 로 읽는다 — 앵커 판정이 벽시계 기준이라 그대로 비교한다. */
function kstClock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function candidate(id: string, name: string, category = 'attraction'): CandidatePlace {
  return {
    id,
    name,
    category,
    address: `부산 어딘가 ${name}`,
    coordinates: { lat: 35.15 + Number(id.slice(-1)) / 1000, lng: 129.11 },
    tags: [],
    confidence: 0.9,
    source: 'fixture',
    reason: '테스트 후보',
  } as unknown as CandidatePlace;
}

/** 저장된 기존 항목 1건. scheduledAt 은 KST 기준으로 넘긴다. */
function storedItem(overrides: {
  id?: string;
  order: number;
  clock: string;
  durationMin: number;
  name?: string;
  coordinates?: { lat: number; lng: number };
  memo?: string;
}) {
  return {
    id: overrides.id ?? `existing-${overrides.order}`,
    tripId: TRIP.id,
    day: 1,
    order: overrides.order,
    type: 'attraction',
    name: overrides.name ?? `기존 장소 ${overrides.order}`,
    address: '부산 어딘가',
    coordinates: overrides.coordinates ?? { lat: 35.2, lng: 129.2 },
    scheduledAt: new Date(`${TODAY}T${overrides.clock}:00+09:00`),
    durationMin: overrides.durationMin,
    ...(overrides.memo ? { memo: overrides.memo } : {}),
  } as any;
}

const TRIP = {
  id: '7ad4657d-cb04-4450-a6af-195e1ceb8791',
  userId: 'user-1',
  title: '부산 여행',
  destination: '부산',
  startDate: TODAY,
  endDate: TODAY,
  status: 'confirmed',
  wakeTime: '08:30',
  sleepTime: '22:00',
  transportMode: 'transit',
  notes: null,
};

function build(opts: {
  trip?: Record<string, unknown>;
  existingItems?: any[];
  /** plannerAgent 가 내놓는 계획 항목 수 (기본 5 — 앵커 상한에 잘리는지 보려고 넉넉히) */
  planItems?: number;
} = {}) {
  const trip = { ...TRIP, ...opts.trip };
  const candidates = Array.from({ length: 6 }, (_, index) =>
    candidate(`p${index + 1}`, `새 장소 ${index + 1}`),
  );
  const tripsRepo = {
    findOneBy: jest.fn(async () => trip),
    save: jest.fn(async () => trip),
  };
  const tripDaysRepo = { find: jest.fn(async () => []) };
  const saved = (items: CreateItineraryItemDto[]) =>
    items.map((item, index) => ({
      ...item,
      id: `saved-${index + 1}`,
      scheduledAt: new Date(item.scheduledAt),
    }));
  const itineraryService = {
    findByTrip: jest.fn(async () => opts.existingItems ?? []),
    replaceTripItems: jest.fn(async (_tripId: string, items: CreateItineraryItemDto[]) => saved(items)),
    replaceDayItems: jest.fn(
      async (_tripId: string, _days: number[], items: CreateItineraryItemDto[]) => saved(items),
    ),
  };
  const preferencesService = {
    findByUser: jest.fn(async () => null),
    getPreferenceVector: jest.fn(async () => null),
  };
  const plannerAgent = {
    // 실제 플래너처럼 "넘겨받은 후보"로 계획한다 — 후보에서 뺀 장소가 다시 배치되지 않는지
    // 보려면 mock 이 자체 목록을 쓰면 안 된다.
    plan: jest.fn(async (options: any) =>
      (options.candidates as CandidatePlace[]).slice(0, opts.planItems ?? 5).map((place, index) => ({
        candidate: place,
        day: 1,
        order: index + 1,
        durationMin: 120,
        memo: 'LLM 배치',
        aiGenerated: true,
      })),
    ),
  };
  const weatherHelper = {
    getExtendedForecast: jest.fn(async () => new Map()),
    buildWeatherHint: jest.fn(() => '날씨 양호'),
  };
  const routeHelper = { getEta: jest.fn(async () => ({ durationSec: 900, distanceM: 3000 })) };
  const placeRetrieval = {
    retrieve: jest.fn(async () => ({
      places: candidates,
      trace: { sources: ['fixture'], averageConfidence: 0.9 },
    })),
  };
  const scheduleConstraint = { apply: jest.fn((items: ItineraryItemDto[]) => items) };
  const constraintEngine = {
    validate: jest.fn(async (items: ItineraryItemDto[]) => ({ valid: true, issues: [], items })),
  };

  const service = new PlannerService(
    tripsRepo as any,
    tripDaysRepo as any,
    itineraryService as any,
    preferencesService as any,
    plannerAgent as any,
    weatherHelper as any,
    routeHelper as any,
    placeRetrieval as any,
    constraintEngine as any,
  );
  return { service, itineraryService, plannerAgent, placeRetrieval };
}

/** 이번 재계획이 저장하려 한 항목들(전체 교체·일차 교체 어느 경로든). */
function storedPayload(itineraryService: any): CreateItineraryItemDto[] {
  return (
    itineraryService.replaceTripItems.mock.calls[0]?.[1] ??
    itineraryService.replaceDayItems.mock.calls[0]?.[2] ??
    []
  );
}

describe('PlannerService 오늘 일차 재계획 앵커', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it('오늘을 다시 짜면 아침이 아니라 지금 이후부터 배치한다', async () => {
    const { service, itineraryService } = build();

    await service.replan({ tripId: TRIP.id, trigger: 'deviation' });

    const stored = storedPayload(itineraryService);
    expect(stored.length).toBeGreaterThan(0);
    // 첫 항목이 기상 시각(08:30)이 아니라 지금(15:00) 이후여야 한다.
    expect(kstClock(stored[0]!.scheduledAt as string) > '15:00').toBe(true);
  });

  it('남은 시간만큼만 담는다 — 하루 목표 개수로 채우지 않는다', async () => {
    const { service, itineraryService } = build();

    await service.replan({ tripId: TRIP.id, trigger: 'manual' });

    // 15:10~22:00(410분)에는 2곳이 상한. LLM 이 5개를 줘도 그만큼만 저장된다.
    expect(storedPayload(itineraryService)).toHaveLength(2);
  });

  it('마지막 항목이 취침 시각을 넘기지 않는다', async () => {
    const { service, itineraryService } = build();

    await service.replan({ tripId: TRIP.id, trigger: 'manual' });

    const stored = storedPayload(itineraryService);
    const last = stored[stored.length - 1]!;
    const endsAt = new Date(last.scheduledAt as string).getTime() + last.durationMin * 60_000;
    expect(endsAt).toBeLessThanOrEqual(new Date(`${TODAY}T22:00:00+09:00`).getTime());
  });

  it('미래 일차는 앵커가 걸리지 않는다 — 기상 시각부터 하루 전체를 짠다', async () => {
    const { service, itineraryService } = build({
      trip: { startDate: TODAY, endDate: '2026-08-04' },
    });

    await service.replan({ tripId: TRIP.id, trigger: 'weather', targetDays: [2] });

    const stored = storedPayload(itineraryService);
    expect(kstClock(stored[0]!.scheduledAt as string)).toBe('08:30');
    expect(stored.length).toBeGreaterThan(2);
  });

  it('기상 전 요청도 앵커 없이 하루 전체를 짠다', async () => {
    jest.setSystemTime(new Date(`${TODAY}T07:00:00+09:00`));
    const { service, itineraryService } = build();

    await service.replan({ tripId: TRIP.id, trigger: 'manual' });

    expect(kstClock(storedPayload(itineraryService)[0]!.scheduledAt as string)).toBe('08:30');
  });

  it('이미 끝난 항목은 그대로 남기고 새 항목을 그 뒤 순서로 잇는다', async () => {
    const done = storedItem({ order: 1, clock: '09:00', durationMin: 90, name: '오전 방문', memo: '주차 앞쪽' });
    const { service, itineraryService } = build({ existingItems: [done] });

    await service.replan({ tripId: TRIP.id, trigger: 'deviation' });

    const stored = storedPayload(itineraryService);
    expect(stored[0]).toMatchObject({ name: '오전 방문', order: 1, memo: '주차 앞쪽' });
    // 보존 항목의 시각·체류가 그대로여야 한다(기록이므로 다시 계산하지 않는다).
    expect(kstClock(stored[0]!.scheduledAt as string)).toBe('09:00');
    expect(stored[1]!.order).toBe(2);
    expect(stored[1]!.name).not.toBe('오전 방문');
  });

  it('보존한 장소는 후보에서 빠져 오늘 두 번 배치되지 않는다', async () => {
    const done = storedItem({
      order: 1,
      clock: '09:00',
      durationMin: 90,
      name: '새 장소 1',
      coordinates: { lat: 35.151, lng: 129.11 },
    });
    const { service, itineraryService } = build({ existingItems: [done] });

    await service.replan({ tripId: TRIP.id, trigger: 'deviation' });

    const names = storedPayload(itineraryService).map((item) => item.name);
    expect(names.filter((name) => name === '새 장소 1')).toHaveLength(1);
  });

  it('진행 중인 항목은 사용자가 그 장소에 있으면 남기고 그 뒤부터 다시 짠다', async () => {
    // 14:30 시작 120분 → 지금(15:00) 진행 중. 사용자 좌표가 그 장소 반경 안.
    const atPlace = { lat: 35.2, lng: 129.2 };
    const ongoing = storedItem({ order: 1, clock: '14:30', durationMin: 120, name: '방문 중', coordinates: atPlace });
    const { service, itineraryService } = build({ existingItems: [ongoing] });

    await service.replan({
      tripId: TRIP.id,
      trigger: 'deviation',
      currentLocation: atPlace,
    });

    const stored = storedPayload(itineraryService);
    expect(stored[0]).toMatchObject({ name: '방문 중', order: 1 });
    // 새 항목은 방문 중인 일정이 끝난 16:30 이후부터.
    expect(kstClock(stored[1]!.scheduledAt as string) >= '16:30').toBe(true);
  });

  it('진행 중이어도 사용자가 멀리 있으면(미도착) 남기지 않고 다시 짠다', async () => {
    const ongoing = storedItem({
      order: 1,
      clock: '14:30',
      durationMin: 120,
      name: '못 간 장소',
      coordinates: { lat: 35.2, lng: 129.2 },
    });
    const { service, itineraryService } = build({ existingItems: [ongoing] });

    await service.replan({
      tripId: TRIP.id,
      trigger: 'deviation',
      // 그 장소에서 10km 이상 떨어진 위치.
      currentLocation: { lat: 35.3, lng: 129.3 },
    });

    expect(storedPayload(itineraryService).map((item) => item.name)).not.toContain('못 간 장소');
  });

  it('남은 활동 시간이 없으면 그 일차를 건드리지 않고 기존 일정을 그대로 돌려준다', async () => {
    jest.setSystemTime(new Date(`${TODAY}T21:50:00+09:00`));
    const kept = storedItem({ order: 1, clock: '09:00', durationMin: 90, name: '오전 방문' });
    const { service, itineraryService, plannerAgent } = build({ existingItems: [kept] });

    const result = await service.replan({ tripId: TRIP.id, trigger: 'manual' });

    expect(itineraryService.replaceTripItems).not.toHaveBeenCalled();
    expect(itineraryService.replaceDayItems).not.toHaveBeenCalled();
    // 계획을 만들지도 않는다 — LLM·검색 호출까지 아낀다.
    expect(plannerAgent.plan).not.toHaveBeenCalled();
    expect(result.map((item) => item.name)).toEqual(['오전 방문']);
  });

  it('여러 일차 중 오늘만 앵커되고 나머지 일차는 그대로 하루 전체를 짠다', async () => {
    const { service, plannerAgent } = build({
      trip: { startDate: TODAY, endDate: '2026-08-04' },
    });

    await service.replan({ tripId: TRIP.id, trigger: 'manual', targetDays: [1, 2] });

    const options = (plannerAgent.plan.mock.calls[0] as any[])[0];
    expect(options.dayStartTimes[0] > '15:00').toBe(true);
    expect(options.dayStartTimes[1]).toBe('08:30');
    // 오늘은 남은 시간만큼(2곳), 내일은 하루 목표 개수.
    expect(options.dayItemTargets[0]).toBe(2);
    expect(options.dayItemTargets[1]).toBe(options.itemsPerDay);
  });

  it('검색 startAt 도 앵커 시각을 쓴다 — 아침 기준 영업시간으로 후보를 고르지 않는다', async () => {
    const { service, placeRetrieval } = build();

    await service.replan({ tripId: TRIP.id, trigger: 'deviation' });

    const context = (placeRetrieval.retrieve.mock.calls[0] as any[])[0];
    expect(kstClock(context.startAt.toISOString()) > '15:00').toBe(true);
  });

  it('앵커된 일차의 첫 항목은 현재 위치에서의 이동시간을 반영한다', async () => {
    const { service, itineraryService } = build();

    await service.replan({
      tripId: TRIP.id,
      trigger: 'deviation',
      currentLocation: { lat: 35.3, lng: 129.3 },
    });

    // 앵커 15:10 + 현재 위치 → 첫 장소 이동 15분(getEta 900초) = 15:25.
    expect(kstClock(storedPayload(itineraryService)[0]!.scheduledAt as string)).toBe('15:25');
  });
});
