/// <reference types="jest" />

import { PlannerService } from '../../src/planner/planner.service';
import { ConstraintEngine } from '../../src/planner/constraint/constraint.engine';
import { ScheduleConstraint } from '../../src/planner/helpers/schedule.constraint';
import type { CandidatePlace } from '../../src/planner/retrieval/types';
import type { CreateItineraryItemDto, ItineraryItemDto } from '@tripick/types';
import { haversineMeters } from '@tripick/utils';

/**
 * 흩어진 후보로 하드 제약이 깨지는 프로덕션 케이스(광역 "부산" 생성 롤백)를 재현한다.
 *
 * pgvector 카탈로그가 시도 단위라 "부산" 검색은 해운대·금정산처럼 시 전역에서 취향 상위를
 * 뽑아 온다. 예전 재시도(단순 rotate)는 순서만 회전시켜 어느 회차에서도 이동시간을 못 맞췄고,
 * 여행 생성 자체가 롤백됐다. 이 스펙은 재시도가 **직전 장소에서 가까운 후보**를 잇는지 본다.
 *
 * 제약 검증은 실제 `ConstraintEngine`·`ScheduleConstraint` 를 쓴다 — mock 으로 valid/invalid 를
 * 흉내내면 "정렬을 바꿨더니 정말 제약을 통과하는가" 를 증명하지 못한다. 경로 API 만 직선거리
 * 기반 추정으로 대체한다.
 */

/** 해운대 권역 기준점. */
const HAEUNDAE = { lat: 35.1587, lng: 129.1604 };
/** 금정산 권역 기준점 — 해운대에서 직선 약 19km. */
const GEUMJEONG = { lat: 35.26, lng: 128.99 };

/** 대중교통 실효 속도(km/h). 두 권역 간 이동이 약 58분으로 나오는 값. */
const TRANSIT_KMH = 20;

const TRIP = {
  id: '7ad4657d-cb04-4450-a6af-195e1ceb8791',
  userId: 'user-1',
  title: '부산 여행',
  destination: '부산광역시',
  startDate: '2026-09-10',
  endDate: '2026-09-10',
  status: 'draft',
  wakeTime: '09:00',
  sleepTime: '22:00',
  transportMode: 'transit' as const,
  notes: null,
};

/**
 * CRAG 점수 순서대로 두 권역이 번갈아 나오는 후보 목록 — 광역 목적지의 실제 검색 결과 모양.
 * 이 순서로 그대로 배치하면 하루에 권역 간 이동이 네 번 들어가 이동시간이 안 나온다.
 */
function scatteredCandidates(): CandidatePlace[] {
  return [
    place('hd-1', '해운대해수욕장', HAEUNDAE),
    place('gj-1', '금정산성', GEUMJEONG),
    place('hd-2', '미포철길', offset(HAEUNDAE, 0.004, 0.002)),
    place('gj-2', '범어사', offset(GEUMJEONG, 0.005, -0.002)),
    place('hd-3', '해운대블루라인파크', offset(HAEUNDAE, -0.003, 0.004)),
    place('gj-3', '금강공원', offset(GEUMJEONG, -0.004, 0.003)),
  ];
}

/** 해운대 권역 후보인지(권역 응집 여부 판정용). */
function isHaeundae(coordinates: { lat: number; lng: number }): boolean {
  return haversineMeters(HAEUNDAE, coordinates) < 2000;
}

describe('PlannerService 재시도 근접 후보 우선', () => {
  it('흩어진 후보로 AI 초안이 하루에 안 들어가면 근접 후보를 이어 붙여 복구한다', async () => {
    const harness = build();

    const result = await harness.service.generateItinerary(TRIP.id);

    // AI 초안(권역 번갈아)은 이동에 시간을 다 써 하루 끝에 걸리고 뒤 항목이 잘려 나간다.
    // 잘려 나간 개수가 재시도 신호다 — 잘린 채로도 하드 제약은 통과하므로, 이걸 안 세면
    // 흩어진 하루가 그대로 저장된다.
    expect(harness.validate.mock.calls.length).toBeGreaterThanOrEqual(2);
    const aiDraft = (await harness.validate.mock.results[0]!.value) as { items: unknown[] };
    expect(aiDraft.items.length).toBeLessThan(result.length);
    expect(harness.itineraryService.replaceTripItems).toHaveBeenCalledTimes(1);
  });

  it('한 일차를 한 권역으로 뭉쳐 채운다 — 권역을 번갈아 배치하지 않는다', async () => {
    const harness = build();

    await harness.service.generateItinerary(TRIP.id);

    const stored = storedPayload(harness.itineraryService);
    // 하루 목표 5곳: 해운대 3곳을 먼저 소진한 뒤 금정산으로 넘어간다. 권역 안에서도 CRAG
    // 순위가 아니라 직전 장소 기준으로 고르므로, 금정산 진입점은 마지막 해운대 항목에서
    // 가장 가까운 금강공원이다.
    expect(stored.map((item) => item.name)).toEqual([
      '해운대해수욕장',
      '미포철길',
      '해운대블루라인파크',
      '금강공원',
      '금정산성',
    ]);
    // 권역 전환은 하루에 한 번뿐이다(번갈아 배치하면 네 번).
    const switches = stored
      .slice(1)
      .filter((item, index) => isHaeundae(item.coordinates) !== isHaeundae(stored[index]!.coordinates));
    expect(switches).toHaveLength(1);
  });

  it('CRAG 상위 후보에서 출발한다 — 근접 정렬이 취향 순위를 뒤집지 않는다', async () => {
    const harness = build();

    await harness.service.generateItinerary(TRIP.id);

    // 시드는 첫 회차엔 후보 1순위. 근접 정렬은 그 뒤 "방문 순서"만 정한다.
    expect(storedPayload(harness.itineraryService)[0]?.name).toBe('해운대해수욕장');
  });

  it('이동시간 총합이 CRAG 순서 그대로 배치한 초안보다 짧다', async () => {
    const harness = build();

    await harness.service.generateItinerary(TRIP.id);

    const travelMin = storedPayload(harness.itineraryService).reduce(
      (sum, item) => sum + (item.travelTimeMin ?? 0),
      0,
    );
    // 번갈아 배치하면 권역 간 이동(약 58분) 4회 = 230분대. 권역별로 뭉치면 1회로 줄어든다.
    expect(travelMin).toBeLessThan(150);
  });

  it('일자별 지역 모드에서도 재시도가 지역 안에서 근접 후보를 잇는다', async () => {
    // 두 일차 모두 "부산" 이지만 지역이 2개 이상이면 per-day 경로(AI 미사용)를 탄다.
    const harness = build({
      trip: { endDate: '2026-09-11' },
      dayRegions: [
        { day: 1, region: '부산광역시' },
        { day: 2, region: '경주' },
      ],
    });

    await harness.service.generateItinerary(TRIP.id);

    // per-day 모드는 AI 플래너를 쓰지 않는다 — 첫 초안이 CRAG 순서 그대로라 제약이 깨지고,
    // 재시도에서 근접 정렬이 걸려 복구된다.
    expect(harness.plannerAgent.plan).not.toHaveBeenCalled();
    expect(harness.validate.mock.calls.length).toBeGreaterThanOrEqual(2);
    const day1 = storedPayload(harness.itineraryService).filter((item) => item.day === 1);
    expect(day1.map((item) => item.name).slice(0, 3)).toEqual([
      '해운대해수욕장',
      '미포철길',
      '해운대블루라인파크',
    ]);
  });

  it('세 회차 모두 하드 제약을 못 맞추면 여전히 저장하지 않고 실패시킨다', async () => {
    const harness = build({ stubValidation: 'alwaysFail' });

    await expect(harness.service.generateItinerary(TRIP.id)).rejects.toThrow(
      /hard constraints/,
    );
    expect(harness.itineraryService.replaceTripItems).not.toHaveBeenCalled();
    expect(harness.tripsRepo.save).not.toHaveBeenCalled();
  });

  it('하루가 짧아 다 못 담으면 줄여서라도 저장한다', async () => {
    // 취침까지 두 시간뿐인 활동 구간 — 어떤 순서로도 5곳이 안 들어간다. 재시도를 아무리 해도
    // 늘어나지 않으므로, 예전처럼 실패시키면 사용자는 몇 번을 눌러도 여행을 못 만든다.
    // 하드 제약을 어긴 게 아니라 시간이 없는 것이니 짧아진 하루를 저장한다.
    const harness = build({ trip: { wakeTime: '20:00', sleepTime: '22:00' } });

    const result = await harness.service.generateItinerary(TRIP.id);

    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(5);
    expect(harness.itineraryService.replaceTripItems).toHaveBeenCalledTimes(1);
  });
});

/** 2026-09-10 11:00 KST — 여행 1일차가 이미 시작된 시각. */
const TODAY_NOW = new Date('2026-09-10T02:00:00Z');

describe('PlannerService 재시도 근접 후보 우선 (오늘 일차 앵커)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(TODAY_NOW);
  });
  afterEach(() => jest.useRealTimers());

  it('오늘을 다시 짜면 현재 위치에서 가까운 후보부터 잇는다', async () => {
    // 앵커된 일차의 첫 이동은 현재 위치에서 출발하므로(buildDraft), 정렬 시드도 거기서 잡는다.
    // CRAG 1순위는 해운대지만 사용자는 금정산 권역에 있다.
    const harness = build({ stubValidation: 'failThenPass' });

    await harness.service.replan({
      tripId: TRIP.id,
      trigger: 'deviation',
      currentLocation: offset(GEUMJEONG, 0.002, 0.001),
    });

    const stored = storedPayload(harness.itineraryService);
    // 현재 위치에서 가장 가까운 금정산성이 시드 — 첫 이동으로 19km 를 되돌아가지 않는다.
    expect(stored[0]?.name).toBe('금정산성');
    expect(stored.slice(0, 3).every((item) => !isHaeundae(item.coordinates))).toBe(true);
  });

  it('현재 위치가 없으면 앵커된 일차도 CRAG 상위에서 출발한다', async () => {
    const harness = build({ stubValidation: 'failThenPass' });

    await harness.service.replan({ tripId: TRIP.id, trigger: 'manual' });

    expect(storedPayload(harness.itineraryService)[0]?.name).toBe('해운대해수욕장');
  });
});

interface BuildOptions {
  trip?: Record<string, unknown>;
  /** trip_days 행. 2개 이상 지역이면 per-day 결정적 배치 경로를 탄다. */
  dayRegions?: Array<{ day: number; region: string }>;
  /**
   * 제약 검증을 실제 엔진 대신 stub 으로 바꾼다. `failThenPass` 는 AI 초안만 실패시켜
   * 재시도 경로를 강제한다 — 앵커된 일차는 buildDraft 가 체류시간을 남은 시간에 맞춰 깎아
   * 실제 엔진으로는 초안이 거의 항상 통과하기 때문이다. `alwaysFail` 은 회차를 다 써도
   * 하드 제약을 못 맞추는 상황(= 저장하면 안 되는 상황)을 만든다.
   */
  stubValidation?: 'failThenPass' | 'alwaysFail';
}

function build(options: BuildOptions = {}) {
  const trip = { ...TRIP, ...options.trip };
  const candidates = scatteredCandidates();

  const tripsRepo = {
    findOneBy: jest.fn(async () => trip),
    save: jest.fn(async () => trip),
  };
  const tripDaysRepo = {
    find: jest.fn(async () =>
      (options.dayRegions ?? []).map((row) => ({ tripId: trip.id, ...row, sortOrder: 0 })),
    ),
  };
  const saved = (items: CreateItineraryItemDto[]) =>
    items.map((item, index) => ({
      ...item,
      id: `saved-${index + 1}`,
      scheduledAt: new Date(item.scheduledAt),
    }));
  const itineraryService = {
    findByTrip: jest.fn(async () => []),
    replaceTripItems: jest.fn(async (_tripId: string, items: CreateItineraryItemDto[]) => saved(items)),
    replaceDayItems: jest.fn(
      async (_tripId: string, _days: number[], items: CreateItineraryItemDto[]) => saved(items),
    ),
  };
  const preferencesService = {
    findByUser: jest.fn(async () => null),
    getPreferenceVector: jest.fn(async () => null),
  };
  // LLM 은 정상 동작한다 — CRAG 순위 그대로(권역 번갈아) 배치하는 게 프로덕션에서 나온 모양.
  const plannerAgent = {
    plan: jest.fn(async (context: { candidates: CandidatePlace[]; dayItemTargets: number[] }) =>
      context.candidates.slice(0, context.dayItemTargets[0] ?? 5).map((candidate, index) => ({
        candidate,
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
    buildWeatherHint: jest.fn(() => ''),
  };
  // 경로 API 만 직선거리 추정으로 대체한다 — 이동시간 판정 자체는 실제 엔진이 한다.
  const routeHelper = {
    getEta: jest.fn(async (from: { lat: number; lng: number }, to: { lat: number; lng: number }) => {
      const distanceM = haversineMeters(from, to);
      return { durationSec: Math.round((distanceM / 1000 / TRANSIT_KMH) * 3600), distanceM };
    }),
  };
  const placeRetrieval = {
    retrieve: jest.fn(async () => ({
      places: candidates,
      trace: { sources: ['pgvector'], averageConfidence: 0.71 },
    })),
  };

  const scheduleConstraint = new ScheduleConstraint();
  const constraintEngine = new ConstraintEngine(routeHelper as any, scheduleConstraint);
  const spyValidate = () => jest.spyOn(constraintEngine, 'validate');
  const validate =
    options.stubValidation === 'failThenPass'
      ? spyValidate()
          .mockResolvedValueOnce({ valid: false, issues: ['AI route gap'], items: [] })
          .mockImplementation(async (items: ItineraryItemDto[]) => ({
            valid: true,
            issues: [],
            items,
          }))
      : options.stubValidation === 'alwaysFail'
        ? spyValidate().mockResolvedValue({
            valid: false,
            issues: ['이동 시간 부족'],
            items: [],
          })
        : spyValidate();

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

  return { service, tripsRepo, itineraryService, plannerAgent, routeHelper, validate };
}

/** 이번 생성이 저장하려 한 항목들(전체 교체·일차 교체 어느 경로든). */
function storedPayload(itineraryService: {
  replaceTripItems: jest.Mock;
  replaceDayItems: jest.Mock;
}): CreateItineraryItemDto[] {
  return (
    itineraryService.replaceTripItems.mock.calls[0]?.[1] ??
    itineraryService.replaceDayItems.mock.calls[0]?.[2] ??
    []
  );
}

function offset(base: { lat: number; lng: number }, dLat: number, dLng: number) {
  return { lat: base.lat + dLat, lng: base.lng + dLng };
}

function place(id: string, name: string, coordinates: { lat: number; lng: number }): CandidatePlace {
  return {
    id,
    name,
    category: 'attraction',
    address: `부산 ${name}`,
    coordinates,
    source: 'pgvector',
    tags: [],
    confidence: 0.71,
    reason: '취향 유사도 상위',
    crag: {
      total: 0.71,
      retrieval: 0.7,
      taste: 0.72,
      locality: 0.7,
      context: 0.7,
      availability: 1,
      popularity: 0.5,
      matchedTags: [],
      penalties: [],
    },
  } as CandidatePlace;
}
