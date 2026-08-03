/// <reference types="jest" />

import { ForbiddenException } from '@nestjs/common';
import { ReplanningService } from '../../src/replanning/replanning.service';
import { REPLAN_LOCATION_MAX_DISTANCE_M } from '../../src/replanning/replanning.constants';
import type { LiveLocation } from '../../src/arrival-alert/live-location.service';
import type { ReplanRequestDto } from '@tripick/types';

/** 1일차 장소(경주 첨성대 부근). */
const DAY1 = { lat: 35.8348, lng: 129.219 };
/** 2일차 장소(부산 해운대 부근) — 1일차에서 60km 이상. */
const DAY2 = { lat: 35.1587, lng: 129.1604 };
/** 1일차 장소에서 ~1.5km — 앵커 인정 범위. */
const NEAR_DAY1 = { lat: 35.8348, lng: 129.2355 };
/** 서울 — 어느 일차 장소에서도 30km 밖. */
const SEOUL = { lat: 37.5665, lng: 126.978 };

function item(day: number, coordinates: { lat: number; lng: number }, id = `item-${day}`) {
  return { id, tripId: 'trip-1', day, name: `장소 ${day}`, coordinates } as any;
}

function loc(base: { lat: number; lng: number }): LiveLocation {
  return { lat: base.lat, lng: base.lng, ts: Date.now() };
}

function build(opts: { items?: any[]; location?: LiveLocation | null; canAccess?: boolean } = {}) {
  const queue = { add: jest.fn(async () => ({ id: 'job-1' })) } as any;
  const itemsRepo = {
    find: jest.fn(async () => opts.items ?? [item(1, DAY1), item(2, DAY2)]),
  } as any;
  const tripMembersService = {
    canAccessTrip: jest.fn(async () => opts.canAccess ?? true),
  } as any;
  const liveLocation = { getFresh: jest.fn(async () => opts.location ?? null) } as any;

  const service = new ReplanningService(queue, itemsRepo, tripMembersService, liveLocation);
  return { service, queue, itemsRepo, tripMembersService, liveLocation };
}

/** 큐에 실제로 실린 잡 데이터. */
function enqueued(queue: any): ReplanRequestDto {
  return queue.add.mock.calls[0][1];
}

function request(overrides: Partial<ReplanRequestDto> = {}): ReplanRequestDto {
  return { tripId: 'trip-1', trigger: 'deviation', ...overrides };
}

describe('ReplanningService — 이탈 재계획 위치 주입', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deviation 이면 서버 캐시의 최신 위치를 잡 데이터에 실어 준다', async () => {
    const { service, queue } = build({ location: loc(NEAR_DAY1) });

    await service.enqueue('u1', request());

    expect(enqueued(queue).currentLocation).toEqual({ lat: NEAR_DAY1.lat, lng: NEAR_DAY1.lng });
  });

  it('클라이언트가 좌표를 보냈으면 덮어쓰지 않는다', async () => {
    const { service, queue, liveLocation } = build({ location: loc(NEAR_DAY1) });
    const client = { lat: 35.84, lng: 129.21 };

    await service.enqueue('u1', request({ currentLocation: client }));

    expect(enqueued(queue).currentLocation).toEqual(client);
    expect(liveLocation.getFresh).not.toHaveBeenCalled();
  });

  it('manual·weather·crowd 는 위치를 조회하지도 않는다 — 여행 전 요청에 반경 앵커가 걸리면 안 된다', async () => {
    for (const trigger of ['manual', 'weather', 'crowd'] as const) {
      const { service, queue, liveLocation } = build({ location: loc(NEAR_DAY1) });

      await service.enqueue('u1', request({ trigger }));

      expect(liveLocation.getFresh).not.toHaveBeenCalled();
      expect(enqueued(queue).currentLocation).toBeUndefined();
    }
  });

  it('위치가 없거나 오래됐으면(getFresh null) 위치 없이 보낸다', async () => {
    const { service, queue } = build({ location: null });

    await service.enqueue('u1', request());

    expect(enqueued(queue).currentLocation).toBeUndefined();
  });

  it('대상 일차 장소에서 임계 거리보다 멀면 앵커를 걸지 않는다', async () => {
    const { service, queue } = build({ location: loc(SEOUL) });

    await service.enqueue('u1', request());

    expect(enqueued(queue).currentLocation).toBeUndefined();
  });

  it('거리 판정은 대상 일차 장소만 본다 — 다른 일차가 가까워도 스킵', async () => {
    // 사용자는 1일차 장소 근처인데 2일차만 다시 짜는 경우. 2일차 장소(부산)에서 60km 이상이라
    // 그 일차 후보를 경주 주변으로 앵커링하면 안 된다.
    const { service, queue } = build({ location: loc(NEAR_DAY1) });

    await service.enqueue('u1', request({ targetDays: [2] }));

    expect(enqueued(queue).currentLocation).toBeUndefined();
  });

  it('좌표를 가진 대상 일차 항목이 없으면(판정 불가) 위치를 싣지 않는다', async () => {
    const { service, queue } = build({ items: [], location: loc(NEAR_DAY1) });

    await service.enqueue('u1', request());

    expect(enqueued(queue).currentLocation).toBeUndefined();
  });

  it('임계 거리는 카카오 검색 반경(20km)보다 크다 — 여행지 안 이동을 앵커로 인정', () => {
    expect(REPLAN_LOCATION_MAX_DISTANCE_M).toBeGreaterThan(20_000);
  });

  it('여행 접근 권한이 없으면 위치 조회 전에 거절한다', async () => {
    const { service, liveLocation, queue } = build({ canAccess: false, location: loc(NEAR_DAY1) });

    await expect(service.enqueue('u1', request())).rejects.toBeInstanceOf(ForbiddenException);
    expect(liveLocation.getFresh).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
