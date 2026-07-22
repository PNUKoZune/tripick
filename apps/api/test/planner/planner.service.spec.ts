/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
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

function createHarness(pace?: 'relaxed' | 'balanced' | 'packed') {
  const candidate = place('place-1', '광안리 카페', 'cafe');
  const tripsRepo = {
    findOneBy: jest.fn().mockResolvedValue({ ...TRIP }),
    save: jest.fn().mockResolvedValue({ ...TRIP, status: 'confirmed' }),
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
  const plannerAgent = {
    plan: jest.fn().mockResolvedValue([
      {
        candidate,
        day: 1,
        order: 1,
        durationMin: 60,
        memo: 'LLM이 고른 카페',
        aiGenerated: true,
      },
    ]),
  };
  const weatherHelper = {
    getForecast: jest.fn().mockResolvedValue(new Map()),
    getExtendedForecast: jest.fn().mockResolvedValue(new Map()),
    buildWeatherHint: jest.fn().mockReturnValue('날씨 양호'),
  };
  const routeHelper = {
    getDrivingEta: jest.fn(),
    getTransitEta: jest.fn(),
  };
  const placeRetrieval = {
    retrieve: jest.fn().mockResolvedValue({
      places: [candidate],
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
      dataQuality: 0.9,
      matchedTags: ['cafe', 'beach'],
      penalties: [],
    },
  };
}
