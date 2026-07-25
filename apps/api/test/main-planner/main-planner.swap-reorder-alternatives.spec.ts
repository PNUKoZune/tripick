/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { MainPlannerService } from '../../src/main-planner/main-planner.service';
import type { CandidatePlace } from '../../src/planner/retrieval/types';

/**
 * swap / reorderItems / getAlternatives 서비스 동작 커버리지.
 * 기존 main-planner 테스트는 addItem·createTrip·DTO 검증만 덮어, 이 세 경로의
 * 실제 동작(장소 교체·순서 재배정·대안 후보 구성/폴백/dedup)이 비어 있었다.
 */

interface FakeItem {
  id: string;
  tripId: string;
  day: number;
  order: number;
  type: string;
  name: string;
  address: string;
  coordinates: { lat: number; lng: number };
  scheduledAt: string;
  durationMin: number;
  travelTimeMin?: number | null;
  kakaoPlaceId?: string | null;
}

function makeItem(over: Partial<FakeItem> & { id: string }): FakeItem {
  return {
    tripId: 'trip-1',
    day: 1,
    order: 1,
    type: 'attraction',
    name: `장소 ${over.id}`,
    address: '주소',
    coordinates: { lat: 35.79, lng: 129.33 },
    scheduledAt: '2026-07-20T01:00:00.000Z',
    durationMin: 60,
    travelTimeMin: null,
    ...over,
  };
}

function candidate(over: Partial<CandidatePlace> & { id: string; name: string }): CandidatePlace {
  return {
    category: 'attraction',
    address: '후보 주소',
    coordinates: { lat: 35.8, lng: 129.34 },
    source: 'pgvector',
    tags: [],
    confidence: 0.9,
    reason: '취향 근거',
    crag: {} as never,
    popularity: 0.5,
    penalties: [],
    ...over,
  } as CandidatePlace;
}

function setup(opts: {
  items?: FakeItem[];
  findOneBy?: FakeItem | null;
  trip?: Record<string, unknown>;
  retrievePlaces?: CandidatePlace[];
  retrieveThrows?: boolean;
  etaSec?: number;
} = {}) {
  const items = opts.items ?? [];
  const saved: FakeItem[] = [];

  const itemsRepo = {
    find: jest.fn(async () => items),
    findOneBy: jest.fn(async () => opts.findOneBy ?? items[0] ?? null),
    findOne: jest.fn(async () => null),
    save: jest.fn(async (entity: FakeItem | FakeItem[]) => {
      const rows = Array.isArray(entity) ? entity : [entity];
      saved.push(...rows);
      return entity;
    }),
  };

  const trip = { id: 'trip-1', userId: 'u1', destination: '경주', notes: null, transportMode: 'transit', ...opts.trip };
  const tripsService = {
    findOne: jest.fn(async () => trip),
    findOneForViewer: jest.fn(async () => trip),
  };
  const preferencesService = {
    findByUser: jest.fn(async () => null),
    getPreferenceVector: jest.fn(async () => null),
  };
  const inboxService = { create: jest.fn(async () => undefined) };
  const placeRetrieval = {
    retrieve: jest.fn(async () => {
      if (opts.retrieveThrows) throw new Error('retrieval down');
      return { places: opts.retrievePlaces ?? [] };
    }),
  };
  const routeHelper = { getEta: jest.fn(async () => ({ durationSec: opts.etaSec ?? 600 })) };

  const noop = {} as never;
  const service = new MainPlannerService(
    noop, // tripsRepo
    itemsRepo as never,
    tripsService as never,
    noop, // tripMembersService
    noop, // friendsService
    preferencesService as never,
    inboxService as never,
    noop, // weatherHelper
    noop, // kakaoLocal
    placeRetrieval as never,
    noop, // placeEmbeddings
    noop, // tourApi
    routeHelper as never,
  );
  const user = { id: 'u1', nickname: '코티' } as never;
  return { service, user, itemsRepo, tripsService, inboxService, placeRetrieval, routeHelper, saved };
}

describe('MainPlannerService.swap', () => {
  it('항목의 장소·좌표·카테고리를 교체하고 이전 장소를 보관·알린다', async () => {
    const item = makeItem({ id: 'item-1', name: '불국사', kakaoPlaceId: 'kakao-old', type: 'attraction' });
    const { service, user, inboxService, saved } = setup({ items: [item], findOneBy: item });

    const result = await service.swap(user, 'trip-1', {
      itemId: 'item-1',
      place: { name: '석굴암', category: 'cafe', address: '경주 토함산', lat: 35.795, lng: 129.35, kakaoPlaceId: 'kakao-new' },
    } as never);

    expect(result.swappedItemId).toBe('item-1');
    expect(result.newItemName).toBe('석굴암');
    expect(result.previousPlace.name).toBe('불국사');
    expect(result.warnings).toBeUndefined(); // 앞뒤 항목이 없어 경고 없음
    // 항목 자체가 새 장소로 갱신됐는지
    expect(item.name).toBe('석굴암');
    expect(item.coordinates).toEqual({ lat: 35.795, lng: 129.35 });
    expect(item.type).toBe('cafe');
    expect(item.kakaoPlaceId).toBe('kakao-new');
    expect(saved).toContain(item);
    expect(inboxService.create).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'replan_ready', payload: { tripId: 'trip-1', itemId: 'item-1' } }),
    );
  });

  it('앞 항목과의 이동시간이 빠듯하면 경고를 반환한다', async () => {
    // 09:00 시작·체류 60분인 앞 항목 바로 뒤 09:30 항목 → 이동 10분까지 감안하면 간격 부족
    const prev = makeItem({ id: 'p', order: 1, name: '앞장소', scheduledAt: '2026-07-20T00:00:00.000Z', durationMin: 60 });
    const target = makeItem({ id: 'item-1', order: 2, name: '대상', scheduledAt: '2026-07-20T00:30:00.000Z' });
    const { service, user } = setup({ items: [prev, target], findOneBy: target, etaSec: 600 });

    const result = await service.swap(user, 'trip-1', {
      itemId: 'item-1',
      place: { name: '새장소', lat: 35.8, lng: 129.36 },
    } as never);

    expect(result.warnings?.length).toBeGreaterThan(0);
    expect(result.warnings?.[0]).toContain('빠듯');
  });
});

describe('MainPlannerService.reorderItems', () => {
  it('새 순서로 order 를 1..n 재배정하고 시작 시각을 오름차순 슬롯에 재배정한다', async () => {
    const a = makeItem({ id: 'a', order: 1, scheduledAt: '2026-07-20T00:00:00.000Z' });
    const b = makeItem({ id: 'b', order: 2, scheduledAt: '2026-07-20T02:00:00.000Z' });
    const c = makeItem({ id: 'c', order: 3, scheduledAt: '2026-07-20T04:00:00.000Z' });
    const { service, user, itemsRepo } = setup({ items: [a, b, c] });

    await service.reorderItems(user, 'trip-1', { day: 1, orderedItemIds: ['c', 'a', 'b'] } as never);

    // 새 순서 c,a,b → order 1,2,3
    expect(c.order).toBe(1);
    expect(a.order).toBe(2);
    expect(b.order).toBe(3);
    // 슬롯 시각은 오름차순 그대로 새 위치에 배정 (타임라인 오름차순 유지)
    expect(c.scheduledAt).toBe('2026-07-20T00:00:00.000Z');
    expect(a.scheduledAt).toBe('2026-07-20T02:00:00.000Z');
    expect(b.scheduledAt).toBe('2026-07-20T04:00:00.000Z');
    expect(itemsRepo.save).toHaveBeenCalled();
  });

  it('순서 목록이 현재 일정과 개수/구성이 다르면 400', async () => {
    const a = makeItem({ id: 'a', order: 1 });
    const b = makeItem({ id: 'b', order: 2 });
    const { service, user, itemsRepo } = setup({ items: [a, b] });

    await expect(
      service.reorderItems(user, 'trip-1', { day: 1, orderedItemIds: ['a', 'zzz'] } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(itemsRepo.save).not.toHaveBeenCalled();
  });
});

describe('MainPlannerService.getAlternatives', () => {
  const item = makeItem({ id: 'item-1', name: '현재장소', type: 'attraction' });

  it('실 후보가 3개 이상이면 그대로 노출하고 realtime=true, 폴백을 안 채운다', async () => {
    const places = [
      candidate({ id: 'c1', name: '후보1' }),
      candidate({ id: 'c2', name: '후보2' }),
      candidate({ id: 'c3', name: '후보3' }),
    ];
    const { service, user } = setup({ items: [item], findOneBy: item, retrievePlaces: places });

    const res = await service.getAlternatives(user, 'trip-1', 'item-1');

    expect(res.realtime).toBe(true);
    expect(res.alternatives).toHaveLength(3);
    expect(res.alternatives.every((a) => a.realPlace)).toBe(true);
    expect(res.itemName).toBe('현재장소');
  });

  it('실 후보가 없고 note 도 없으면 mock 후보로 3개까지 채우고 realtime=false', async () => {
    const { service, user } = setup({ items: [item], findOneBy: item, retrievePlaces: [] });

    const res = await service.getAlternatives(user, 'trip-1', 'item-1');

    expect(res.realtime).toBe(false);
    expect(res.alternatives).toHaveLength(3);
    expect(res.alternatives.every((a) => a.realPlace)).toBe(false);
  });

  it('note 가 있으면 결과 없음을 그대로 노출한다 (폴백 미보충)', async () => {
    const { service, user } = setup({ items: [item], findOneBy: item, retrievePlaces: [] });

    const res = await service.getAlternatives(user, 'trip-1', 'item-1', '조용한 카페');

    expect(res.realtime).toBe(false);
    expect(res.alternatives).toHaveLength(0);
  });

  it('이미 일정에 담긴 장소는 대안에서 제외한다', async () => {
    const used = makeItem({ id: 'used', name: '겹치는후보' });
    const places = [
      candidate({ id: 'c1', name: '겹치는후보' }), // 일정에 이미 있음 → 제외
      candidate({ id: 'c2', name: '새후보1' }),
      candidate({ id: 'c3', name: '새후보2' }),
    ];
    // find({where:{tripId}}) 가 dedup 용 tripItems 를 돌려준다
    const { service, user } = setup({ items: [item, used], findOneBy: item, retrievePlaces: places });

    const res = await service.getAlternatives(user, 'trip-1', 'item-1');

    const names = res.alternatives.map((a) => a.name);
    expect(names).not.toContain('겹치는후보');
    expect(names).toEqual(expect.arrayContaining(['새후보1', '새후보2']));
  });
});
