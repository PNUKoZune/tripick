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

/** 큐에 남아 있는 잡(진행 중 dedup 조회용). */
function inFlightJob(
  data: Partial<ReplanRequestDto> & { tripId: string },
  opts: { id?: string; state?: string } = {},
) {
  return {
    id: opts.id ?? 'job-running',
    timestamp: Date.now() - 5_000,
    data: { trigger: 'manual', ...data } as ReplanRequestDto,
    getState: jest.fn(async () => opts.state ?? 'active'),
  };
}

function build(
  opts: {
    items?: any[];
    location?: LiveLocation | null;
    canAccess?: boolean;
    /** 큐에 이미 들어 있는 잡. `'fail'` 이면 조회 자체가 실패한다(Redis 무응답) */
    inFlight?: ReturnType<typeof inFlightJob>[] | 'fail';
  } = {},
) {
  const queue = {
    add: jest.fn(async () => ({ id: 'job-1' })),
    getJobs: jest.fn(async () => {
      if (opts.inFlight === 'fail') throw new Error('redis down');
      return opts.inFlight ?? [];
    }),
  } as any;
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

describe('ReplanningService — 진행 중 재계획 dedup', () => {
  beforeEach(() => jest.clearAllMocks());

  /** jobId 에서 10초 버킷을 뗀 부분(= 여행·범위 키). */
  function jobKey(queue: any): string {
    const jobId: string = queue.add.mock.calls[0][2].jobId;
    return jobId.slice(0, jobId.lastIndexOf('-'));
  }

  it('트리거가 달라도 같은 일차면 진행 중인 잡을 돌려준다 — 배너(weather) → FAB(manual)', async () => {
    const { service, queue } = build({
      inFlight: [inFlightJob({ tripId: 'trip-1', trigger: 'weather', targetDays: [2] })],
    });

    const result = await service.enqueue('u1', request({ trigger: 'manual', targetDays: [2] }));

    expect(queue.add).not.toHaveBeenCalled();
    expect(result).toMatchObject({ jobId: 'job-running', deduped: true, status: 'processing' });
    // 트리거는 실제로 도는 잡의 것 — 이번 요청 것이 아니다.
    expect(result.trigger).toBe('weather');
  });

  it('대기 중인 잡은 pending 으로 돌려준다', async () => {
    const { service } = build({
      inFlight: [inFlightJob({ tripId: 'trip-1' }, { state: 'waiting' })],
    });

    await expect(service.enqueue('u1', request({ trigger: 'manual' }))).resolves.toMatchObject({
      status: 'pending',
      deduped: true,
    });
  });

  it('10초 창을 넘겨 다시 눌러도 합쳐진다 — 재계획은 분 단위라 창으로는 못 막는다', async () => {
    const running = inFlightJob({ tripId: 'trip-1', targetDays: [1] });
    running.timestamp = Date.now() - 90_000;
    const { service, queue } = build({ inFlight: [running] });

    await service.enqueue('u1', request({ trigger: 'manual', targetDays: [1] }));

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('겹치지 않는 일차는 별개 작업이라 그대로 등록한다', async () => {
    const { service, queue } = build({
      inFlight: [inFlightJob({ tripId: 'trip-1', targetDays: [1] })],
    });

    const result = await service.enqueue('u1', request({ trigger: 'manual', targetDays: [2] }));

    expect(queue.add).toHaveBeenCalled();
    expect(result.deduped).toBeUndefined();
  });

  it('한쪽이 전체 재계획이면 어느 일차와도 겹친다', async () => {
    // 전체 진행 중 + 일부 요청
    const whole = build({ inFlight: [inFlightJob({ tripId: 'trip-1' })] });
    await whole.service.enqueue('u1', request({ trigger: 'manual', targetDays: [3] }));
    expect(whole.queue.add).not.toHaveBeenCalled();

    // 일부 진행 중 + 전체 요청
    const partial = build({ inFlight: [inFlightJob({ tripId: 'trip-1', targetDays: [3] })] });
    await partial.service.enqueue('u1', request({ trigger: 'manual' }));
    expect(partial.queue.add).not.toHaveBeenCalled();
  });

  it('다른 여행의 잡은 막지 않는다', async () => {
    const { service, queue } = build({
      inFlight: [inFlightJob({ tripId: 'trip-2', targetDays: [1] })],
    });

    await service.enqueue('u1', request({ trigger: 'manual', targetDays: [1] }));

    expect(queue.add).toHaveBeenCalled();
  });

  it('조회 사이에 끝난 잡이면 정상 등록한다 — 지나간 결과를 기다리게 두면 안 된다', async () => {
    for (const state of ['completed', 'failed'] as const) {
      const { service, queue } = build({
        inFlight: [inFlightJob({ tripId: 'trip-1' }, { state })],
      });

      await service.enqueue('u1', request({ trigger: 'manual' }));

      expect(queue.add).toHaveBeenCalled();
    }
  });

  it('큐 조회가 실패해도(Redis 무응답) 요청을 죽이지 않고 등록한다', async () => {
    const { service, queue } = build({ inFlight: 'fail' });

    await expect(service.enqueue('u1', request({ trigger: 'manual' }))).resolves.toMatchObject({
      jobId: 'job-1',
      status: 'pending',
    });
    expect(queue.add).toHaveBeenCalled();
  });

  it('레이스 가드 jobId 에 트리거가 없다 — 같은 창의 weather·manual 이 한 잡으로 합쳐진다', async () => {
    const weather = build();
    await weather.service.enqueue('u1', request({ trigger: 'weather', targetDays: [2] }));
    const manual = build();
    await manual.service.enqueue('u1', request({ trigger: 'manual', targetDays: [2] }));

    expect(jobKey(weather.queue)).toBe('trip-1-2');
    expect(jobKey(manual.queue)).toBe('trip-1-2');
  });

  it('레이스 가드 jobId 는 범위를 구분한다 — 1일차 → 곧바로 2일차가 합쳐지면 안 된다', async () => {
    const day1 = build();
    await day1.service.enqueue('u1', request({ trigger: 'manual', targetDays: [1] }));
    const day23 = build();
    await day23.service.enqueue('u1', request({ trigger: 'manual', targetDays: [3, 2] }));
    const whole = build();
    await whole.service.enqueue('u1', request({ trigger: 'manual' }));

    expect(jobKey(day1.queue)).toBe('trip-1-1');
    // 정렬해 한 범위가 한 키로 모인다
    expect(jobKey(day23.queue)).toBe('trip-1-2.3');
    expect(jobKey(whole.queue)).toBe('trip-1-all');
  });
});
