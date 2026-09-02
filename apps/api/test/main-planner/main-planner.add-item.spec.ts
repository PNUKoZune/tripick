/// <reference types="jest" />

import { MainPlannerService } from '../../src/main-planner/main-planner.service';

/**
 * addItem 이 수동 추가 장소의 영업시간을 채우는 경로를 검증한다.
 * 1) kakaoPlaceId 로 적재된 place_embeddings 재사용 (DB, 외부 API 없음)
 * 2) DB miss + 좌표 있으면 KTO 이름+좌표 매칭 런타임 조회 (tourApi.resolveOpeningHours)
 * 3) 좌표 없으면(자유 입력) KTO 조회 생략
 */
function setup(opts: { db?: string | null; kto?: string | undefined } = {}) {
  const saved: Record<string, unknown>[] = [];
  const findOpeningHoursByKakaoId = jest.fn().mockResolvedValue(opts.db ?? null);
  const resolveOpeningHours = jest.fn().mockResolvedValue(opts.kto);

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
    { resolveOpeningHours } as never, // tourApi
    noop, // routeHelper
    noop, // groupPreferences (이 테스트 경로에서는 사용 안 함)
  );
  const user = { id: 'u1' } as never;
  return { service, user, findOpeningHoursByKakaoId, resolveOpeningHours, saved };
}

const base = { day: 1, name: '불국사', scheduledAt: '10:00' };
const coords = { lat: 35.7903, lng: 129.332 };

describe('MainPlannerService.addItem — 영업시간 보강', () => {
  describe('DB 재사용 (kakaoPlaceId)', () => {
    it('적재된 영업시간이 있으면 재사용하고 KTO 는 호출하지 않는다', async () => {
      const { service, user, findOpeningHoursByKakaoId, resolveOpeningHours, saved } = setup({
        db: '09:00-18:00',
      });

      const item = await service.addItem(user, 'trip-1', { ...base, kakaoPlaceId: 'kakao-42', ...coords } as never);

      expect(findOpeningHoursByKakaoId).toHaveBeenCalledWith('kakao-42');
      expect(resolveOpeningHours).not.toHaveBeenCalled();
      expect(saved[0]!.openingHours).toBe('09:00-18:00');
      expect(item.openingHours).toBe('09:00-18:00');
    });
  });

  describe('KTO 런타임 조회 (DB miss + 좌표)', () => {
    it('DB miss 이고 좌표가 있으면 이름+좌표로 KTO 조회한다', async () => {
      const { service, user, resolveOpeningHours, saved } = setup({ db: null, kto: '09:00-17:00' });

      await service.addItem(user, 'trip-1', { ...base, kakaoPlaceId: 'kakao-99', ...coords } as never);

      expect(resolveOpeningHours).toHaveBeenCalledWith('불국사', coords);
      expect(saved[0]!.openingHours).toBe('09:00-17:00');
    });

    it('kakaoPlaceId 없이 좌표만 있어도 KTO 조회한다 (지도 선택, 미적재)', async () => {
      const { service, user, findOpeningHoursByKakaoId, resolveOpeningHours, saved } = setup({
        kto: '10:00-22:00',
      });

      await service.addItem(user, 'trip-1', { ...base, ...coords } as never);

      expect(findOpeningHoursByKakaoId).not.toHaveBeenCalled();
      expect(resolveOpeningHours).toHaveBeenCalledWith('불국사', coords);
      expect(saved[0]!.openingHours).toBe('10:00-22:00');
    });

    it('KTO 도 못 찾으면 openingHours 를 붙이지 않는다', async () => {
      const { service, user, resolveOpeningHours, saved } = setup({ db: null, kto: undefined });

      await service.addItem(user, 'trip-1', { ...base, ...coords } as never);

      expect(resolveOpeningHours).toHaveBeenCalled();
      expect(saved[0]!.openingHours).toBeUndefined();
    });
  });

  describe('좌표 없는 자유 입력', () => {
    it('좌표가 없으면 KTO 조회를 건너뛴다 (오매칭 방지)', async () => {
      const { service, user, resolveOpeningHours, saved } = setup({ kto: '09:00-18:00' });

      await service.addItem(user, 'trip-1', base as never);

      expect(resolveOpeningHours).not.toHaveBeenCalled();
      expect(saved[0]!.openingHours).toBeUndefined();
    });
  });
});
