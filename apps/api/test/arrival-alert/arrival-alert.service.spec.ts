/// <reference types="jest" />

import { ArrivalAlertService } from '../../src/arrival-alert/arrival-alert.service';
import {
  ARRIVAL_GRACE_MIN,
  ARRIVAL_RADIUS_M,
} from '../../src/arrival-alert/arrival-alert.constants';
import type { LiveLocation } from '../../src/arrival-alert/live-location.service';

const NOW = new Date('2026-07-20T09:00:00Z');
/** 항목 좌표(서울시청 부근). */
const PLACE = { lat: 37.5665, lng: 126.978 };
/** 좌표와 동일 → 반경 안(도착). */
const NEAR = { lat: 37.5665, lng: 126.978 };
/** 좌표에서 ~3.7km 북쪽 → 반경(500m) 밖(미도착). */
const FAR = { lat: 37.6, lng: 126.978 };

/** "시작+유예"를 막 지난(20분 전 시작) due 항목 하나. */
function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    tripId: 'trip-1',
    day: 1,
    name: '경복궁',
    coordinates: PLACE,
    scheduledAt: new Date(NOW.getTime() - (ARRIVAL_GRACE_MIN + 5) * 60_000),
    ...overrides,
  } as any;
}

function trip(overrides: Record<string, unknown> = {}) {
  return { id: 'trip-1', title: '서울 여행', status: 'confirmed', ...overrides } as any;
}

function loc(base: { lat: number; lng: number }, ageMs = 0): LiveLocation {
  return { lat: base.lat, lng: base.lng, ts: NOW.getTime() - ageMs };
}

function build(opts: {
  trips?: any[];
  items?: any[];
  userIds?: string[];
  /** userId → 최신 위치(없으면 판정 불가). */
  locations?: Record<string, LiveLocation | null>;
}) {
  const tripsRepo = { find: jest.fn(async () => opts.trips ?? [trip()]) } as any;
  const itemsRepo = { find: jest.fn(async () => opts.items ?? [item()]) } as any;
  const inboxService = { create: jest.fn(async () => ({ id: 'n1' })) } as any;
  const tripMembersService = {
    getNotificationTargets: jest.fn(async () => ({
      tripTitle: '서울 여행',
      userIds: opts.userIds ?? ['u1'],
    })),
  } as any;

  const claimed = new Set<string>();
  const liveLocation = {
    getFresh: jest.fn(async (userId: string) => opts.locations?.[userId] ?? null),
    claimAlert: jest.fn(async (tripId: string, userId: string, day: number) => {
      const key = `${tripId}:${userId}:${day}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    }),
  } as any;

  const service = new ArrivalAlertService(
    tripsRepo,
    itemsRepo,
    inboxService,
    tripMembersService,
    liveLocation,
  );
  return { service, tripsRepo, itemsRepo, inboxService, tripMembersService, liveLocation };
}

describe('ArrivalAlertService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('시작+유예를 지나도 반경 밖이면 arrival_alert 를 보낸다', async () => {
    const { service, inboxService } = build({ locations: { u1: loc(FAR) } });

    const alerted = await service.scanDueItems(NOW);

    expect(alerted).toBe(1);
    expect(inboxService.create).toHaveBeenCalledTimes(1);
    const dto = inboxService.create.mock.calls[0][0];
    expect(dto.category).toBe('arrival_alert');
    expect(dto.userId).toBe('u1');
    expect(dto.payload).toMatchObject({ tripId: 'trip-1', day: '1', itemId: 'item-1' });
    expect(dto.body).toContain('경복궁');
  });

  it('반경 안에 있으면(도착) 알리지 않는다', async () => {
    const { service, inboxService, liveLocation } = build({ locations: { u1: loc(NEAR) } });

    expect(await service.scanDueItems(NOW)).toBe(0);
    expect(inboxService.create).not.toHaveBeenCalled();
    // 도착이면 선점하지 않는다 — 이후 다른 항목 판정 여지를 남긴다
    expect(liveLocation.claimAlert).not.toHaveBeenCalled();
  });

  it('위치가 없거나 오래되면 판정하지 않는다', async () => {
    const { service, inboxService } = build({ locations: { u1: null } });

    expect(await service.scanDueItems(NOW)).toBe(0);
    expect(inboxService.create).not.toHaveBeenCalled();
  });

  it('자동 재계획을 걸지 않는다 — 알림만 만든다', async () => {
    const { service, inboxService } = build({ locations: { u1: loc(FAR) } });

    await service.scanDueItems(NOW);

    // 재계획 큐를 주입받지 않는 설계이므로 부수효과는 인박스 생성뿐이어야 한다.
    expect(inboxService.create).toHaveBeenCalledTimes(1);
  });

  it('같은 (여행, 사용자, 일차) 는 재알림하지 않는다', async () => {
    const { service, inboxService } = build({ locations: { u1: loc(FAR) } });

    expect(await service.scanDueItems(NOW)).toBe(1);
    expect(await service.scanDueItems(NOW)).toBe(0);
    expect(inboxService.create).toHaveBeenCalledTimes(1);
  });

  it('사용자별로 각자 위치로 판정한다 — 근처인 사람은 빼고 먼 사람만 알린다', async () => {
    const { service, inboxService } = build({
      userIds: ['near', 'far'],
      locations: { near: loc(NEAR), far: loc(FAR) },
    });

    const alerted = await service.scanDueItems(NOW);

    expect(alerted).toBe(1);
    expect(inboxService.create).toHaveBeenCalledTimes(1);
    expect(inboxService.create.mock.calls[0][0].userId).toBe('far');
  });

  it('active 상태가 아닌 여행은 스킵한다', async () => {
    const { service, inboxService } = build({
      trips: [], // tripsRepo 가 active 여행을 못 찾음(cancelled/draft/completed)
      locations: { u1: loc(FAR) },
    });

    expect(await service.scanDueItems(NOW)).toBe(0);
    expect(inboxService.create).not.toHaveBeenCalled();
  });

  it('이른 항목부터 판정해 그날 첫 미도착만 알린다(항목당 도배 방지)', async () => {
    const early = item({ id: 'early', name: '이른 일정', scheduledAt: new Date(NOW.getTime() - 40 * 60_000) });
    const late = item({ id: 'late', name: '늦은 일정', scheduledAt: new Date(NOW.getTime() - 20 * 60_000) });
    const { service, inboxService } = build({
      items: [late, early], // 입력 순서가 뒤섞여 있어도
      locations: { u1: loc(FAR) },
    });

    const alerted = await service.scanDueItems(NOW);

    expect(alerted).toBe(1);
    // 이른 항목이 그날을 선점한다
    expect(inboxService.create.mock.calls[0][0].payload.itemId).toBe('early');
  });

  it('좌표 없는 항목은 판정 대상에서 제외한다', async () => {
    const { service, inboxService } = build({
      items: [item({ coordinates: null })],
      locations: { u1: loc(FAR) },
    });

    expect(await service.scanDueItems(NOW)).toBe(0);
    expect(inboxService.create).not.toHaveBeenCalled();
  });

  it('발송 실패해도 선점 키를 유지해 재시도가 중복 발송하지 않는다', async () => {
    const { service, inboxService } = build({ locations: { u1: loc(FAR) } });
    inboxService.create.mockRejectedValueOnce(new Error('inbox down'));

    expect(await service.scanDueItems(NOW)).toBe(0);
    expect(inboxService.create).toHaveBeenCalledTimes(1);

    // 재시도: 이미 선점된 (여행,사용자,일차) 라 다시 보내지 않는다
    expect(await service.scanDueItems(NOW)).toBe(0);
    expect(inboxService.create).toHaveBeenCalledTimes(1);
  });

  it('반경 임계 근처를 정확히 가른다', async () => {
    // 좌표에서 정남 ~600m (임계 500m 밖) → 알림
    const justOutside = { lat: PLACE.lat - 600 / 111_320, lng: PLACE.lng };
    const { service, inboxService } = build({ locations: { u1: loc(justOutside) } });

    expect(await service.scanDueItems(NOW)).toBe(1);
    expect(ARRIVAL_RADIUS_M).toBe(500);
    expect(inboxService.create).toHaveBeenCalledTimes(1);
  });

  it('중복 억제 TTL 을 그 항목의 KST 일자 끝까지로 잡는다 — 하루 일정이 6h 넘어도 1회', async () => {
    // KST 09:15 시작 항목. 고정 6시간이면 15:15 에 풀려 오후 항목이 재알림되던 문제를 막는다.
    const scheduledAt = new Date('2026-07-20T00:15:00Z'); // = KST 2026-07-20 09:15
    const now = new Date('2026-07-20T00:30:00Z'); // = KST 09:30
    const { service, liveLocation } = build({
      items: [item({ scheduledAt })],
      locations: { u1: loc(FAR) },
    });

    await service.scanDueItems(now);

    const ttlSec = liveLocation.claimAlert.mock.calls[0][3] as number;
    const expected = Math.ceil((Date.parse('2026-07-21T00:00:00+09:00') - now.getTime()) / 1000);
    expect(ttlSec).toBe(expected);
    // 6시간(21600) 을 넘겨 하루 남은 일정을 전부 덮는다
    expect(ttlSec).toBeGreaterThan(6 * 60 * 60);
  });
});
