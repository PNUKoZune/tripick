/// <reference types="jest" />

import { BadRequestException, Logger } from '@nestjs/common';
import { PlannerService } from '../../src/planner/planner.service';
import type { CandidatePlace } from '../../src/planner/retrieval/types';
import type { ItineraryItemDto } from '@tripick/types';

describe('PlannerService hard constraints', () => {
  it('expands the daily target beyond the pace minimum for a long activity window', async () => {
    const harness = createHarness('relaxed');
    harness.constraintEngine.validate.mockImplementation(async (items: ItineraryItemDto[]) => ({
      valid: true,
      issues: [],
      items,
    }));

    await harness.service.generateItinerary(TRIP.id);

    expect(harness.plannerAgent.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        minimumItemsPerDay: 3,
        itemsPerDay: 5,
        wakeTime: '09:00',
        sleepTime: '22:00',
      }),
    );
  });

  it('개장 시각으로 미룬 항목이 그 일차 날짜에 남는다 (전날로 새지 않는다)', async () => {
    // 기본 기상 08:30 + 10:00 개장. 예전 구현은 시간만 setUTCHours 로 바꿔서, KST 09:00 이전
    // 시각은 UTC 날짜가 하루 전이라 결과가 통째로 전날 10:00 이 됐다. 검증이 전부 시각 기준이라
    // 아무 데서도 안 걸렸고, 도착 알림만 엉뚱한 날 떴다.
    const harness = createHarness(undefined, {
      trip: { wakeTime: '08:30' },
      openingHours: '10:00-22:00',
    });
    harness.constraintEngine.validate.mockImplementation(
      async (items: ItineraryItemDto[]) => ({ valid: true, issues: [], items }),
    );

    const items = await harness.service.generateItinerary(TRIP.id);

    expect(items[0]!.scheduledAt).toBe(new Date('2026-07-10T10:00:00+09:00').toISOString());
  });

  it('rebuilds an invalid AI draft with deterministic CRAG fallback before saving', async () => {
    const harness = createHarness();
    // 1회차(AI 초안)는 제약 위반, 이후(폴백 초안)는 통과하도록 구성한다.
    harness.constraintEngine.validate
      .mockResolvedValueOnce({ valid: false, issues: ['AI route gap'], items: [] })
      .mockImplementation(async (items: ItineraryItemDto[]) => ({ valid: true, issues: [], items }));

    const result = await harness.service.generateItinerary(TRIP.id);

    expect(result).toHaveLength(1);
    // AI 초안 검증(실패) + 폴백 초안 검증(통과)으로 최소 2회 호출 → 재구성 경로가 실행됐음을 증명.
    expect(harness.constraintEngine.validate.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(harness.itineraryService.replaceTripItems).toHaveBeenCalledTimes(1);

    const stored = harness.itineraryService.replaceTripItems.mock.calls[0]?.[1] ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('광안리 카페');
    // memo 는 사용자 메모 공간이라 생성 단계 AI 추론을 저장하지 않는다(의도된 동작).
    expect(stored[0]?.memo).toBeUndefined();
    expect(harness.tripsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
  });

  it('preserves a user memo on the matching place when replanning', async () => {
    const harness = createHarness();
    harness.constraintEngine.validate.mockImplementation(async (items: ItineraryItemDto[]) => ({
      valid: true,
      issues: [],
      items,
    }));
    // 재계획 전 저장돼 있던 같은 장소에 사용자가 남긴 메모.
    harness.itineraryService.findByTrip.mockResolvedValue([
      {
        name: '광안리 카페',
        coordinates: { lat: 35.1532, lng: 129.1185 },
        memo: '12시 예약, 주차 앞쪽',
      },
    ]);

    await harness.service.replan({ tripId: TRIP.id, trigger: 'manual' });

    const stored = harness.itineraryService.replaceTripItems.mock.calls[0]?.[1] ?? [];
    expect(stored).toHaveLength(1);
    // 같은 장소가 다시 배치됐으므로 사용자 메모가 새 항목으로 이어져야 한다.
    expect(stored[0]?.memo).toBe('12시 예약, 주차 앞쪽');
  });

  it('stores plain place names on a triggered replan (no trigger token in the name)', async () => {
    const harness = createHarness();
    harness.constraintEngine.validate.mockImplementation(async (items: ItineraryItemDto[]) => ({
      valid: true,
      issues: [],
      items,
    }));
    // 1일차에 2개 이상 배치돼야 예전 접미사 조건(day===1 && order>=1)에 걸린다.
    harness.plannerAgent.plan.mockResolvedValue([
      { candidate: place('p1', '광안리 카페', 'cafe'), day: 1, order: 1, durationMin: 60, memo: '', aiGenerated: true },
      { candidate: place('p2', '해동용궁사', 'attraction'), day: 1, order: 2, durationMin: 60, memo: '', aiGenerated: true },
    ]);

    await harness.service.replan({ tripId: TRIP.id, trigger: 'crowd' });

    const stored = harness.itineraryService.replaceTripItems.mock.calls[0]?.[1] ?? [];
    // 트리거 맥락은 memo 로만 남긴다 — 장소명에 영문 enum 을 붙이면 화면·공유·메모 매칭이 다 깨진다.
    expect(stored.map((item: ItineraryItemDto) => item.name)).toEqual(['광안리 카페', '해동용궁사']);
  });

  it('does not replace stored itinerary items when AI and fallback drafts violate hard constraints', async () => {
    const harness = createHarness();
    harness.constraintEngine.validate.mockResolvedValue({
      valid: false,
      issues: ['opening hours violation'],
      items: [],
    });

    await expect(harness.service.generateItinerary(TRIP.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.itineraryService.replaceTripItems).not.toHaveBeenCalled();
    expect(harness.tripsRepo.save).not.toHaveBeenCalled();
  });
});

const TRIP = {
  id: '7ad4657d-cb04-4450-a6af-195e1ceb8791',
  userId: 'user-1',
  title: '부산 여행',
  destination: '부산',
  startDate: '2026-07-10',
  endDate: '2026-07-10',
  status: 'draft',
  wakeTime: '09:00',
  sleepTime: '22:00',
  transportMode: 'transit',
  notes: '카페 위주',
};

function createHarness(
  pace?: 'relaxed' | 'balanced' | 'packed',
  overrides: {
    trip?: Record<string, unknown>;
    openingHours?: string;
    /** 검색이 돌려줄 후보 풀. 생략하면 종전대로 1건(얇은 풀). */
    pool?: CandidatePlace[];
  } = {},
) {
  const trip = { ...TRIP, ...overrides.trip };
  const candidate = {
    ...place('place-1', '광안리 카페', 'cafe'),
    ...(overrides.openingHours ? { openingHours: overrides.openingHours } : {}),
  };
  const tripsRepo = {
    findOneBy: jest.fn().mockResolvedValue({ ...trip }),
    save: jest.fn().mockResolvedValue({ ...trip, status: 'confirmed' }),
  };
  // trip_days 없음 → 모든 날 = trip.destination(단일 지역) 경로를 탄다
  const tripDaysRepo = {
    find: jest.fn().mockResolvedValue([]),
  };
  const itineraryService = {
    findByTrip: jest.fn().mockResolvedValue([]),
    replaceTripItems: jest.fn(async (_tripId: string, items: ItineraryItemDto[]) =>
      items.map((item, index) => ({
        ...item,
        id: `saved-${index + 1}`,
        scheduledAt: new Date(item.scheduledAt),
      })),
    ),
  };
  const preferencesService = {
    findByUser: jest.fn().mockResolvedValue({
      tasteTags: {
        food: ['cafe'],
        mood: ['healing'],
        environment: ['beach'],
        confidence: 0.9,
      },
      ...(pace ? { profile: { pace } } : {}),
    }),
    getPreferenceVector: jest.fn().mockResolvedValue(null),
  };
  const pool = overrides.pool ?? [candidate];
  const plannerAgent = {
    plan: jest.fn().mockResolvedValue(
      pool.map((item, index) => ({
        candidate: item,
        day: 1,
        order: index + 1,
        durationMin: 60,
        memo: 'LLM이 고른 카페',
        aiGenerated: true,
      })),
    ),
  };
  const weatherHelper = {
    getForecast: jest.fn().mockResolvedValue(new Map()),
    getExtendedForecast: jest.fn().mockResolvedValue(new Map()),
    buildWeatherHint: jest.fn().mockReturnValue('날씨 양호'),
  };
  const routeHelper = {
    getDrivingEta: jest.fn(),
    getTransitEta: jest.fn(),
    getEta: jest.fn().mockResolvedValue({ durationSec: 900, distanceM: 3000 }),
  };
  const placeRetrieval = {
    retrieve: jest.fn().mockResolvedValue({
      places: pool,
      trace: { sources: ['fixture'], averageConfidence: 0.91 },
    }),
  };
  const scheduleConstraint = {
    apply: jest.fn((items: ItineraryItemDto[]) => items),
  };
  const constraintEngine = {
    validate: jest.fn(),
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
    scheduleConstraint as any,
    constraintEngine as any,
  );

  return {
    service,
    tripsRepo,
    itineraryService,
    constraintEngine,
    plannerAgent,
  };
}

describe('PlannerService 일자별 지역', () => {
  it('일자별 지역이면 각 일차를 그 날 지역 후보로만 채우고 AI 플래너를 쓰지 않는다', async () => {
    const busan = place('busan-1', '광안리 카페', 'cafe');
    const gyeongju = place('gyeongju-1', '불국사', 'attraction');
    const trip = { ...TRIP, startDate: '2026-07-10', endDate: '2026-07-11' }; // 2일

    const tripsRepo = {
      findOneBy: jest.fn().mockResolvedValue(trip),
      save: jest.fn().mockResolvedValue({ ...trip, status: 'confirmed' }),
    };
    const tripDaysRepo = {
      find: jest.fn().mockResolvedValue([
        { tripId: trip.id, day: 1, region: '부산', sortOrder: 0 },
        { tripId: trip.id, day: 2, region: '경주', sortOrder: 0 },
      ]),
    };
    const itineraryService = {
      findByTrip: jest.fn().mockResolvedValue([]),
      replaceTripItems: jest.fn(async (_tripId: string, items: ItineraryItemDto[]) =>
        items.map((item, index) => ({
          ...item,
          id: `saved-${index + 1}`,
          scheduledAt: new Date(item.scheduledAt),
        })),
      ),
    };
    const preferencesService = {
      findByUser: jest.fn().mockResolvedValue(null),
      getPreferenceVector: jest.fn().mockResolvedValue(null),
    };
    // 일자별 모드에서는 호출되면 안 된다.
    const plannerAgent = { plan: jest.fn() };
    const weatherHelper = {
      getExtendedForecast: jest.fn().mockResolvedValue(new Map()),
      buildWeatherHint: jest.fn().mockReturnValue('날씨 양호'),
    };
    const routeHelper = { getDrivingEta: jest.fn(), getTransitEta: jest.fn() };
    const placeRetrieval = {
      retrieve: jest.fn(async (ctx: { destination: string }) => ({
        places: ctx.destination === '부산' ? [busan] : [gyeongju],
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
      scheduleConstraint as any,
      constraintEngine as any,
    );

    await service.generateItinerary(trip.id);

    // 지역-스코프 결정적 배치를 쓰므로 AI 플래너는 호출되지 않는다.
    expect(plannerAgent.plan).not.toHaveBeenCalled();
    // 지역별로 각각 조회한다.
    expect(placeRetrieval.retrieve).toHaveBeenCalledWith(expect.objectContaining({ destination: '부산' }));
    expect(placeRetrieval.retrieve).toHaveBeenCalledWith(expect.objectContaining({ destination: '경주' }));

    const stored = itineraryService.replaceTripItems.mock.calls[0]?.[1] ?? [];
    expect(stored.filter((i) => i.day === 1).map((i) => i.name)).toEqual(['광안리 카페']);
    expect(stored.filter((i) => i.day === 2).map((i) => i.name)).toEqual(['불국사']);
  });
});

describe('PlannerService 일자별 재계획', () => {
  it('대상 일차만 다시 만들고 나머지 일차는 저장된 일정 그대로 둔다', async () => {
    const harness = createPartialHarness();

    const result = await harness.service.replan({
      tripId: TRIP.id,
      trigger: 'manual',
      targetDays: [2],
    });

    // 전체 교체(replaceTripItems)가 아니라 2일차만 교체한다.
    expect(harness.itineraryService.replaceTripItems).not.toHaveBeenCalled();
    expect(harness.itineraryService.replaceDayItems).toHaveBeenCalledTimes(1);
    const [, days, stored] = harness.itineraryService.replaceDayItems.mock.calls[0]!;
    expect(days).toEqual([2]);
    expect(stored.map((item: ItineraryItemDto) => item.day)).toEqual([2]);
    // 2일차 항목은 여행 시작일(7/10)이 아니라 실제 2일차 날짜(7/11)에 잡힌다.
    expect(stored[0]?.scheduledAt.slice(0, 10)).toBe('2026-07-11');

    // 응답은 유지한 일차까지 합친 여행 전체 일정이다.
    expect(result.map((item) => [item.day, item.name])).toEqual([
      [1, '광안리 카페'],
      [2, '감천문화마을'],
      [3, '태종대'],
    ]);
  });

  it('AI 플래너에는 대상 일차 수만큼만 계획하게 하고 결과를 실제 일차로 되돌린다', async () => {
    const harness = createPartialHarness();

    await harness.service.replan({ tripId: TRIP.id, trigger: 'weather', targetDays: [2] });

    expect(harness.plannerAgent.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        dayCount: 1,
        dayDates: ['2026-07-11'],
      }),
    );
    // 플래너는 day: 1 로 계획했지만 저장은 실제 2일차로 되돌아간다.
    const [, , stored] = harness.itineraryService.replaceDayItems.mock.calls[0]!;
    expect(stored[0]?.day).toBe(2);
  });

  it('비연속 범위는 실제 날짜 목록으로 넘어간다 (연속 2일로 뭉개지지 않는다)', async () => {
    const harness = createPartialHarness();

    await harness.service.replan({ tripId: TRIP.id, trigger: 'manual', targetDays: [1, 3] });

    // 시작·종료일 두 값이면 7/10~7/12(3일)인데 dayCount 는 2 라 프롬프트가 자기모순이었다.
    expect(harness.plannerAgent.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        dayCount: 2,
        dayDates: ['2026-07-10', '2026-07-12'],
      }),
    );
  });

  it('날씨 힌트는 다시 짜는 일차의 예보만 본다', async () => {
    const harness = createPartialHarness();

    await harness.service.replan({ tripId: TRIP.id, trigger: 'weather', targetDays: [2] });

    // 1·3일차 강수까지 힌트에 실리면 다시 짜지도 않는 날의 비를 피해 실내 장소가 당겨진다.
    expect(harness.weatherHelper.buildWeatherHint).toHaveBeenCalledWith(expect.anything(), ['20260711']);
  });

  it('유지되는 일차에 이미 있는 장소는 후보에서 뺀다', async () => {
    const harness = createPartialHarness();

    await harness.service.replan({ tripId: TRIP.id, trigger: 'manual', targetDays: [2] });

    const candidates: CandidatePlace[] = harness.plannerAgent.plan.mock.calls[0]![0].candidates;
    // 1일차에 그대로 남는 '광안리 카페'가 후보로 다시 들어오면 같은 장소가 두 일차에 중복된다.
    expect(candidates.map((candidate) => candidate.name)).toEqual(['감천문화마을']);
  });

  it('여행 범위를 벗어난 일차만 들어오면 전체 재계획으로 되돌린다', async () => {
    const harness = createPartialHarness();

    await harness.service.replan({ tripId: TRIP.id, trigger: 'manual', targetDays: [9] });

    expect(harness.itineraryService.replaceDayItems).not.toHaveBeenCalled();
    expect(harness.itineraryService.replaceTripItems).toHaveBeenCalledTimes(1);
  });
});

/** 3일 여행 + 각 일차에 저장된 항목이 하나씩 있는 부분 재계획 하네스 */
function createPartialHarness() {
  const trip = { ...TRIP, startDate: '2026-07-10', endDate: '2026-07-12' };
  const keptDay1 = savedItem('item-1', 1, '광안리 카페', '2026-07-10T00:00:00.000Z');
  const keptDay3 = savedItem('item-3', 3, '태종대', '2026-07-12T00:00:00.000Z');
  const staleDay2 = savedItem('item-2', 2, '해동용궁사', '2026-07-11T00:00:00.000Z');
  const fresh = place('fresh-1', '감천문화마을', 'attraction');
  // 1일차에 그대로 남는 장소와 이름이 같은 후보 — 중복 배치 방지 대상.
  const duplicate = place('dup-1', '광안리 카페', 'cafe');

  const tripsRepo = {
    findOneBy: jest.fn().mockResolvedValue(trip),
    save: jest.fn().mockResolvedValue(trip),
  };
  const tripDaysRepo = { find: jest.fn().mockResolvedValue([]) };
  const itineraryService = {
    findByTrip: jest.fn().mockResolvedValue([keptDay1, staleDay2, keptDay3]),
    replaceTripItems: jest.fn(async (_tripId: string, items: ItineraryItemDto[]) =>
      items.map((item, index) => ({ ...item, id: `saved-${index + 1}`, scheduledAt: new Date(item.scheduledAt) })),
    ),
    replaceDayItems: jest.fn(async (_tripId: string, _days: number[], items: ItineraryItemDto[]) =>
      items.map((item, index) => ({ ...item, id: `saved-${index + 1}`, scheduledAt: new Date(item.scheduledAt) })),
    ),
  };
  const preferencesService = {
    findByUser: jest.fn().mockResolvedValue(null),
    getPreferenceVector: jest.fn().mockResolvedValue(null),
  };
  const plannerAgent = {
    plan: jest.fn(async (options: { candidates: CandidatePlace[] }) =>
      options.candidates.slice(0, 1).map((candidate) => ({
        candidate,
        day: 1,
        order: 1,
        durationMin: 90,
        memo: 'LLM 배치',
        aiGenerated: true,
      })),
    ),
  };
  const weatherHelper = {
    getExtendedForecast: jest.fn().mockResolvedValue(new Map()),
    buildWeatherHint: jest.fn().mockReturnValue('날씨 양호'),
  };
  const routeHelper = { getEta: jest.fn().mockResolvedValue({ durationSec: 900, distanceM: 3000 }) };
  const placeRetrieval = {
    retrieve: jest.fn().mockResolvedValue({
      places: [duplicate, fresh],
      trace: { sources: ['fixture'], averageConfidence: 0.9 },
    }),
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
    scheduleConstraint as any,
    constraintEngine as any,
  );

  return { service, itineraryService, plannerAgent, placeRetrieval, weatherHelper };
}

function savedItem(id: string, day: number, name: string, scheduledAt: string) {
  return {
    id,
    tripId: TRIP.id,
    day,
    order: 1,
    type: 'attraction' as const,
    name,
    address: '부산 어딘가',
    coordinates: { lat: 35.1 + day, lng: 129.1 + day },
    scheduledAt: new Date(scheduledAt),
    durationMin: 90,
  };
}

/**
 * 얇은 후보 풀은 **조용히** 짧은 일정이 된다 — 적게 담은 하루는 이동·영업시간·활동 구간 어느
 * 제약도 어기지 않아 검증이 valid 를 돌려주고 그대로 저장된다. `shortfall` 은 "배치안 대비
 * 잘려 나간 수"라 애초에 배치안이 짧으면 0 이어서 그 경로로도 안 잡혔다.
 */
describe('PlannerService 항목 부족 경고', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('목표를 못 채우면 일차별 수치와 풀 크기를 남긴다', async () => {
    const harness = createHarness(); // 풀 1건, 하루 목표 5개
    harness.constraintEngine.validate.mockImplementation(
      async (items: ItineraryItemDto[]) => ({ valid: true, issues: [], items }),
    );

    await harness.service.generateItinerary(TRIP.id);

    expect(shortfallWarning(warn)).toContain('1일차 1/5');
    expect(shortfallWarning(warn)).toContain('후보 풀 1건');
  });

  it('통째로 빈 일차는 따로 짚는다', async () => {
    const harness = createHarness(undefined, {
      trip: { endDate: '2026-07-11' }, // 2일 여행인데 풀은 1건
    });
    harness.constraintEngine.validate.mockImplementation(
      async (items: ItineraryItemDto[]) => ({ valid: true, issues: [], items }),
    );

    await harness.service.generateItinerary(TRIP.id);

    expect(shortfallWarning(warn)).toContain('2일차 0/5');
    expect(shortfallWarning(warn)).toContain('빈 일차: 2');
  });

  it('목표를 채우면 조용하다', async () => {
    const harness = createHarness(undefined, {
      pool: [
        place('p-1', '광안리 카페', 'cafe'),
        place('p-2', '해운대 식당', 'restaurant'),
        place('p-3', '감천문화마을', 'attraction'),
        place('p-4', '자갈치시장', 'attraction'),
        place('p-5', '태종대', 'attraction'),
      ],
    });
    harness.constraintEngine.validate.mockImplementation(
      async (items: ItineraryItemDto[]) => ({ valid: true, issues: [], items }),
    );

    await harness.service.generateItinerary(TRIP.id);

    expect(shortfallWarning(warn)).toBeUndefined();
  });
});

/** 부족 경고만 골라낸다 — 같은 로거로 재시도 경고도 나오므로 메시지로 가른다. */
function shortfallWarning(warn: jest.SpyInstance): string | undefined {
  return warn.mock.calls
    .map((call) => String(call[0]))
    .find((message) => message.includes('일정이 목표보다 짧습니다'));
}

function place(id: string, name: string, category: string): CandidatePlace {
  return {
    id,
    name,
    category,
    address: '부산 수영구 광안해변로 219',
    coordinates: { lat: 35.1532, lng: 129.1185 },
    source: 'pgvector',
    tags: ['cafe', 'beach', 'healing'],
    confidence: 0.91,
    reason: '선호 태그 cafe, beach 일치',
    openingHours: '09:00-22:00',
    crag: {
      total: 0.91,
      retrieval: 0.9,
      taste: 0.95,
      locality: 0.9,
      context: 0.85,
      availability: 1,
      popularity: 0.8,
      matchedTags: ['cafe', 'beach'],
      penalties: [],
    },
  };
}
