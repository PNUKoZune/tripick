/// <reference types="jest" />

import { PlannerService } from '../../src/planner/planner.service';
import { PlannerAgentService } from '../../src/planner/agent/planner-agent.service';
import type { CandidatePlace } from '../../src/planner/retrieval/types';
import type { CreateItineraryItemDto, ItineraryItemDto } from '@tripick/types';

/** 2026-08-03 10:00 KST — 오늘 일차의 12시·18시 요청이 아직 유효한 시각. */
const NOW = new Date('2026-08-03T01:00:00Z');
const TODAY = '2026-08-03';
/** 앵커가 걸리지 않는 미래 일차. */
const FUTURE = '2026-08-10';

function kstClock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function candidate(id: string, name: string, category = 'attraction', openingHours?: string): CandidatePlace {
  return {
    id,
    name,
    category,
    address: `부산 어딘가 ${name}`,
    coordinates: { lat: 35.15 + Number(id.replace(/\D/g, '')) / 1000, lng: 129.11 },
    tags: [],
    confidence: 0.9,
    source: 'fixture',
    reason: '테스트 후보',
    ...(openingHours ? { openingHours } : {}),
  } as unknown as CandidatePlace;
}

const TRIP = {
  id: '7ad4657d-cb04-4450-a6af-195e1ceb8791',
  userId: 'user-1',
  title: '부산 여행',
  destination: '부산',
  startDate: FUTURE,
  endDate: FUTURE,
  status: 'confirmed',
  wakeTime: '08:30',
  sleepTime: '22:00',
  transportMode: 'transit',
  notes: null,
};

function build(opts: {
  trip?: Record<string, unknown>;
  candidates?: CandidatePlace[];
  /** LLM mock 이 배치할 후보 id (순서 = order). 기본은 관광지 5곳. */
  llmPick?: string[];
  /** true 면 LLM 을 끈 실제 PlannerAgentService 로 결정적 폴백을 탄다(요청 문장을 못 읽는 경로). */
  llmDown?: boolean;
  /** 앞에서부터 이 횟수만큼 제약 검증을 실패시켜 재생성 경로를 태운다. */
  failValidations?: number;
} = {}) {
  const trip = { ...TRIP, ...opts.trip };
  const candidates =
    opts.candidates ??
    [
      ...Array.from({ length: 6 }, (_, index) => candidate(`p${index + 1}`, `관광지 ${index + 1}`)),
      candidate('r1', '돼지국밥집', 'restaurant'),
      candidate('r2', '횟집', 'restaurant'),
      candidate('c1', '바다뷰 카페', 'cafe'),
    ];
  const byId = new Map(candidates.map((place) => [place.id, place]));
  const tripsRepo = {
    findOneBy: jest.fn(async () => trip),
    save: jest.fn(async () => trip),
  };
  const saved = (items: CreateItineraryItemDto[]) =>
    items.map((item, index) => ({ ...item, id: `saved-${index + 1}`, scheduledAt: new Date(item.scheduledAt) }));
  const itineraryService = {
    findByTrip: jest.fn(async () => []),
    replaceTripItems: jest.fn(async (_tripId: string, items: CreateItineraryItemDto[]) => saved(items)),
    replaceDayItems: jest.fn(
      async (_tripId: string, _days: number[], items: CreateItineraryItemDto[]) => saved(items),
    ),
  };
  const pick = opts.llmPick ?? ['p1', 'p2', 'p3', 'p4', 'p5'];
  const realAgent = new PlannerAgentService({
    get: (key: string, fallback: unknown) => (key === 'LLM_PLANNER_ENABLED' ? 'false' : fallback),
  } as any);
  const plannerAgent = {
    plan: jest.fn(async (options: any) =>
      opts.llmDown
        ? realAgent.plan(options)
        : pick.map((id, index) => ({
            candidate: byId.get(id)!,
            day: 1,
            order: index + 1,
            durationMin: byId.get(id)!.category === 'attraction' ? 120 : 60,
            memo: 'LLM 배치',
            aiGenerated: true,
          })),
    ),
  };
  let failures = opts.failValidations ?? 0;
  const constraintEngine = {
    validate: jest.fn(async (items: ItineraryItemDto[]) => {
      if (failures > 0) {
        failures -= 1;
        return { valid: false, issues: ['강제 실패'], items };
      }
      return { valid: true, issues: [], items };
    }),
  };

  const service = new PlannerService(
    tripsRepo as any,
    { find: jest.fn(async () => []) } as any,
    itineraryService as any,
    { findByUser: jest.fn(async () => null) } as any,
    plannerAgent as any,
    {
      getExtendedForecast: jest.fn(async () => new Map()),
      buildWeatherHint: jest.fn(() => '날씨 양호'),
    } as any,
    { getEta: jest.fn(async () => ({ durationSec: 900, distanceM: 3000 })) } as any,
    {
      retrieve: jest.fn(async () => ({
        places: candidates,
        trace: { sources: ['fixture'], averageConfidence: 0.9 },
      })),
    } as any,
    constraintEngine as any,
    { forTrip: jest.fn().mockResolvedValue({ memberCount: 1, vectorMemberCount: 0 }) } as never,
  );
  return { service, itineraryService, plannerAgent };
}

function stored(itineraryService: any): CreateItineraryItemDto[] {
  return (
    itineraryService.replaceTripItems.mock.calls[0]?.[1] ??
    itineraryService.replaceDayItems.mock.calls[0]?.[2] ??
    []
  );
}

function at(items: CreateItineraryItemDto[], name: string): string | undefined {
  const item = items.find((entry) => entry.name === name);
  return item ? kstClock(item.scheduledAt as string) : undefined;
}

describe('PlannerService 재계획 요청 문장의 시각 지정', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it('"카페 12시에 추가해줘" — LLM 이 카페를 안 넣어도 12:00 에 카페가 들어간다', async () => {
    const { service, itineraryService } = build();

    await service.replan({ tripId: TRIP.id, trigger: 'manual', note: '카페 12시에 추가해줘' });

    const items = stored(itineraryService);
    expect(at(items, '바다뷰 카페')).toBe('12:00');
    expect(items.filter((item) => item.type === 'cafe')).toHaveLength(1);
  });

  it('이미 들어 있는 카페는 새로 추가하지 않고 지정 시각으로 옮긴다', async () => {
    // LLM 이 카페를 오후(4번째)에 배치한 상황.
    const { service, itineraryService } = build({ llmPick: ['p1', 'p2', 'r1', 'c1', 'p3'] });

    await service.replan({ tripId: TRIP.id, trigger: 'manual', note: '12시에 카페 가고 싶어' });

    const items = stored(itineraryService);
    expect(at(items, '바다뷰 카페')).toBe('12:00');
    expect(items.filter((item) => item.type === 'cafe')).toHaveLength(1);
  });

  it('지정 시각 앞 항목은 그 시각에 맞춰 끝나고, 순서가 시각 순으로 이어진다', async () => {
    const { service, itineraryService } = build();

    await service.replan({ tripId: TRIP.id, trigger: 'manual', note: '카페 12시' });

    const items = [...stored(itineraryService)].sort((a, b) => a.order - b.order);
    const times = items.map((item) => new Date(item.scheduledAt as string).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const cafeIndex = items.findIndex((item) => item.name === '바다뷰 카페');
    const before = items[cafeIndex - 1]!;
    const beforeEnd = new Date(before.scheduledAt as string).getTime() + before.durationMin * 60_000;
    expect(beforeEnd).toBeLessThanOrEqual(new Date(`${FUTURE}T12:00:00+09:00`).getTime());
  });

  it('장소 이름을 말하면 그 장소를 지정 시각에 둔다', async () => {
    const { service, itineraryService } = build();

    await service.replan({ tripId: TRIP.id, trigger: 'manual', note: '저녁 6시에 횟집 가자' });

    expect(at(stored(itineraryService), '횟집')).toBe('18:00');
  });

  it('시각이 여럿이면 모두 지킨다', async () => {
    const { service, itineraryService } = build();

    await service.replan({
      tripId: TRIP.id,
      trigger: 'manual',
      note: '12시에 카페 들르고 저녁 7시에 식당',
    });

    const items = stored(itineraryService);
    expect(at(items, '바다뷰 카페')).toBe('12:00');
    expect(items.some((item) => item.type === 'restaurant' && at(items, item.name) === '19:00')).toBe(true);
  });

  it('LLM 이 죽어 결정적 폴백을 타도 지정 시각을 지킨다', async () => {
    const { service, itineraryService } = build({ llmDown: true });

    await service.replan({ tripId: TRIP.id, trigger: 'manual', note: '카페 12시에 추가해줘' });

    const items = stored(itineraryService);
    // 폴백은 카페를 오후 휴식 슬롯(15:30 근처)에 두는데, 그걸 12:00 으로 당겨야 한다.
    expect(items.length).toBeGreaterThan(3);
    expect(at(items, '바다뷰 카페')).toBe('12:00');
    expect(items.filter((item) => item.type === 'cafe')).toHaveLength(1);
  });

  it('제약 검증 실패로 재생성 경로를 타도 지정 시각을 지킨다', async () => {
    const { service, itineraryService } = build({ failValidations: 1 });

    await service.replan({ tripId: TRIP.id, trigger: 'manual', note: '카페 12시에 추가해줘' });

    expect(at(stored(itineraryService), '바다뷰 카페')).toBe('12:00');
  });

  it('LLM 프롬프트에도 시각 고정을 싣는다', async () => {
    const { service, plannerAgent } = build();

    await service.replan({ tripId: TRIP.id, trigger: 'manual', note: '카페 12시에 추가해줘' });

    const options = (plannerAgent.plan.mock.calls[0] as any[])[0];
    expect(options.timeAnchors).toEqual([{ day: 1, time: '12:00', category: 'cafe' }]);
  });

  it('개장 전 시각이면 개장 시각까지 밀리고, 가장 나은 안으로 저장한다', async () => {
    const candidates = [
      ...Array.from({ length: 5 }, (_, index) => candidate(`p${index + 1}`, `관광지 ${index + 1}`)),
      candidate('c1', '늦게 여는 카페', 'cafe', '13:00-22:00'),
    ];
    const { service, itineraryService } = build({ candidates });

    await service.replan({ tripId: TRIP.id, trigger: 'manual', note: '카페 12시' });

    // 영업시간이 사용자 지정보다 우선한다 — 문 닫힌 곳에 12시에 보내지 않는다.
    expect(at(stored(itineraryService), '늦게 여는 카페')).toBe('13:00');
  });

  it('오늘 일차에서 이미 지난 시각은 무시하고 앞으로의 시각만 지킨다', async () => {
    jest.setSystemTime(new Date(`${TODAY}T13:00:00+09:00`));
    const { service, itineraryService } = build({ trip: { startDate: TODAY, endDate: TODAY } });

    await service.replan({
      tripId: TRIP.id,
      trigger: 'manual',
      note: '12시에 카페 들르고 저녁 6시에 횟집',
    });

    const items = stored(itineraryService);
    expect(at(items, '횟집')).toBe('18:00');
    expect(items.every((item) => kstClock(item.scheduledAt as string) >= '13:10')).toBe(true);
  });

  it('오늘 재계획에서 고정 시각 앞 빈 시간을 비워 두지 않는다', async () => {
    // 실측 재현: 15:51 요청 → 16:01 시작, 남은 시간 상한 2개를 고정 항목 둘이 다 차지해
    // 16:00~18:00 이 비었다.
    jest.setSystemTime(new Date(`${TODAY}T15:51:00+09:00`));
    const { service, itineraryService, plannerAgent } = build({
      trip: { startDate: TODAY, endDate: TODAY },
    });

    await service.replan({
      tripId: TRIP.id,
      trigger: 'manual',
      note: '저녁 6시에 카페 들르고 7시 반에 저녁 식사',
    });

    const items = [...stored(itineraryService)].sort((a, b) => a.order - b.order);
    expect(at(items, '바다뷰 카페')).toBe('18:00');
    expect(items.some((item) => item.type === 'restaurant' && at(items, item.name) === '19:30')).toBe(true);
    const beforeCafe = items.filter((item) => kstClock(item.scheduledAt as string) < '18:00');
    expect(beforeCafe).toHaveLength(1);
    // LLM 에도 넓어진 개수를 넘긴다.
    expect((plannerAgent.plan.mock.calls[0] as any[])[0].dayItemTargets).toEqual([3]);
  });

  it('시각이 없는 요청은 기존 배치를 그대로 둔다', async () => {
    const { service, itineraryService } = build();

    await service.replan({ tripId: TRIP.id, trigger: 'manual', note: '카페 하나 추가해줘' });

    const items = stored(itineraryService);
    expect(at(items, '관광지 1')).toBe('08:30');
    expect(items.map((item) => item.name)).not.toContain('바다뷰 카페');
  });
});
