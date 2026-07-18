/// <reference types="jest" />

import { MainPlannerService } from '../../src/main-planner/main-planner.service';

/**
 * addItem 이 수동 추가 장소의 영업시간을 적재된 place_embeddings 에서 채우는지 검증한다.
 * (kakaoPlaceId 로 DB lookup — 외부 API 왕복 없음)
 */
function setup(openingHours: string | null) {
  const saved: Record<string, unknown>[] = [];
  const findOpeningHoursByKakaoId = jest.fn().mockResolvedValue(openingHours);

  const itemsRepo = {
    // 1) addItem 의 dayItems 조회 → 빈 하루 2) recompute 재조회 → 저장분
    find: jest
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementation(async () => saved),
    findOne: jest.fn().mockResolvedValue(null), // fallback 좌표 없음 → 기본 좌표
    findOneBy: jest.fn().mockImplementation(async () => saved[0]),
    create: jest.fn().mockImplementation((entity) => ({ id: 'item-1', ...entity })),
    save: jest.fn().mockImplementation(async (entity) => {
      const row = { ...entity };
      if (saved.length === 0) saved.push(row);
      return row;
    }),
  };

  const tripsService = {
    findOne: jest.fn().mockResolvedValue({ id: 'trip-1', startDate: '2026-07-20' }),
  };

  const noop = {} as never;
  const service = new MainPlannerService(
    noop, // tripsRepo
    itemsRepo as never,
    tripsService as never,
    noop, // tripMembersService
    noop, // friendsService
    noop, // preferencesService
    noop, // inboxService
    noop, // weatherHelper
    noop, // kakaoLocal
    noop, // placeRetrieval
    { findOpeningHoursByKakaoId } as never, // placeEmbeddings
    noop, // routeHelper
  );
  const user = { id: 'u1' } as never;
  return { service, user, itemsRepo, findOpeningHoursByKakaoId, saved };
}

describe('MainPlannerService.addItem — 영업시간 보강', () => {
  const baseDto = { day: 1, name: '불국사', scheduledAt: '10:00' } as never;

  it('kakaoPlaceId 로 적재된 영업시간을 항목에 채운다', async () => {
    const { service, user, findOpeningHoursByKakaoId, saved } = setup('09:00-18:00');

    await service.addItem(user, 'trip-1', { ...(baseDto as object), kakaoPlaceId: 'kakao-42' } as never);

    expect(findOpeningHoursByKakaoId).toHaveBeenCalledWith('kakao-42');
    expect(saved[0]!.openingHours).toBe('09:00-18:00');
  });

  it('적재된 영업시간이 없으면 항목에 openingHours 를 붙이지 않는다', async () => {
    const { service, user, findOpeningHoursByKakaoId, saved } = setup(null);

    await service.addItem(user, 'trip-1', { ...(baseDto as object), kakaoPlaceId: 'kakao-99' } as never);

    expect(findOpeningHoursByKakaoId).toHaveBeenCalledWith('kakao-99');
    expect(saved[0]!.openingHours).toBeUndefined();
  });

  it('kakaoPlaceId 가 없으면 조회 자체를 건너뛴다 (자유 입력 장소)', async () => {
    const { service, user, findOpeningHoursByKakaoId, saved } = setup('09:00-18:00');

    await service.addItem(user, 'trip-1', baseDto);

    expect(findOpeningHoursByKakaoId).not.toHaveBeenCalled();
    expect(saved[0]!.openingHours).toBeUndefined();
  });
});
