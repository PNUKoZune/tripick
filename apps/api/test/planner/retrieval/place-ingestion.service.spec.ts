/// <reference types="jest" />

import { PlaceIngestionService } from '../../../src/planner/retrieval/place-ingestion.service';

/**
 * 시군구 단위 타깃('속초')이 기본 소스에서 통째로 버려지던 회귀를 막는다.
 * tour 는 KTO 시도 코드가 필요해 못 돌지만, 그게 카카오·popular 수집까지 취소할 이유는 아니다.
 */
describe('PlaceIngestionService 지역 타깃 해석', () => {
  it('시도로 안 잡히는 지역도 tour 만 건너뛰고 카카오는 적재한다', async () => {
    const deps = mockDeps();
    const service = build(deps);

    const summary = await service.ingest({
      regions: ['속초'],
      sources: ['tour', 'kakao'],
      maxPerRegion: 4,
    });

    expect(deps.tourApi.fetchByArea).not.toHaveBeenCalled();
    expect(summary.regions.map((r) => r.region)).toEqual(['속초']);
    expect(summary.totalInserted).toBe(1);
    expect(deps.repository.upsertPlace).toHaveBeenCalledWith(
      expect.objectContaining({ name: '속초 등대 전망대', region: '속초' }),
      expect.any(Array),
      undefined,
    );
  });

  it('빈 시도 코드로 KTO 전국 조회가 새지 않는다', async () => {
    const deps = mockDeps();
    // KTO 목록을 못 받아도(키 없음) 카카오만으로 돌 수 있다 — 이때 areaCode 가 빈 문자열이다.
    deps.tourApi.fetchSidoList.mockResolvedValue([]);
    const service = build(deps);

    await service.ingest({ sources: ['kakao'], maxPerRegion: 4 });

    expect(deps.tourApi.fetchByArea).not.toHaveBeenCalled();
  });

  it('tour 만 요청했는데 시도로 안 잡히면 그 타깃을 건너뛴다', async () => {
    const deps = mockDeps();
    const service = build(deps);

    const summary = await service.ingest({
      regions: ['속초'],
      sources: ['tour'],
      maxPerRegion: 4,
    });

    expect(summary.regions).toHaveLength(0);
    expect(deps.repository.upsertPlace).not.toHaveBeenCalled();
  });

  it('시도로 잡히는 지역은 KTO 시도 코드로 tour 를 돌린다', async () => {
    const deps = mockDeps();
    const service = build(deps);

    await service.ingest({ regions: ['강원'], sources: ['tour'], maxPerRegion: 4 });

    expect(deps.tourApi.fetchByArea).toHaveBeenCalledWith(
      '51',
      '강원특별자치도',
      4,
      0,
      expect.anything(),
    );
  });

  it('append 는 오프셋 커서를 이어받아 저장한다', async () => {
    const deps = mockDeps();
    deps.cursors.getNextOffset.mockResolvedValue(250);
    deps.tourApi.fetchByArea.mockResolvedValue({
      places: [],
      nextOffset: 350,
      quotaExceeded: false,
    });
    const service = build(deps);

    await service.ingest({
      regions: ['강원'],
      sources: ['tour'],
      maxPerRegion: 100,
      append: true,
    });

    expect(deps.tourApi.fetchByArea).toHaveBeenCalledWith(
      '51',
      '강원특별자치도',
      100,
      250,
      expect.anything(),
    );
    expect(deps.cursors.setNextOffset).toHaveBeenCalledWith('강원특별자치도', 'tour', 350);
  });
});

/**
 * 임베딩 텍스트에 수집 라벨이 들어가 같은 장소가 타깃마다 다른 해시를 갖던 회귀를 막는다.
 * (해시가 흔들리면 증분 적재가 무력화되고 매 실행 재임베딩된다)
 */
describe('PlaceIngestionService 임베딩 텍스트 안정성', () => {
  it('같은 장소는 시도 타깃·시군구 타깃에서 같은 텍스트 해시를 갖는다', async () => {
    const sido = mockDeps();
    await build(sido).ingest({ regions: ['강원'], sources: ['kakao'], maxPerRegion: 4 });

    const sigungu = mockDeps();
    await build(sigungu).ingest({ regions: ['속초'], sources: ['kakao'], maxPerRegion: 4 });

    const hashOf = (deps: MockDeps): unknown =>
      deps.repository.upsertPlace.mock.calls[0]![0].textHash;
    // 수집 라벨은 다르지만('강원특별자치도' vs '속초') 주소에서 파생한 정본 코드는 같다.
    expect(sido.repository.upsertPlace.mock.calls[0]![0].region).toBe('강원특별자치도');
    expect(sigungu.repository.upsertPlace.mock.calls[0]![0].region).toBe('속초');
    expect(hashOf(sido)).toBe(hashOf(sigungu));
  });
});

type MockDeps = ReturnType<typeof mockDeps>;

function mockDeps() {
  return {
    config: { get: jest.fn((_key: string, fallback?: unknown) => fallback) },
    tourApi: {
      fetchSidoList: jest.fn().mockResolvedValue([{ code: '51', name: '강원특별자치도' }]),
      fetchByArea: jest.fn().mockResolvedValue({ places: [], nextOffset: 0, quotaExceeded: false }),
      createCallBudget: jest.fn(() => ({ isExhausted: false, consume: () => true })),
    },
    kakaoLocal: {
      resolveCenter: jest.fn().mockResolvedValue({ lat: 38.207, lng: 128.591 }),
      searchAround: jest.fn().mockResolvedValue([
        {
          kakaoPlaceId: 'k-1',
          name: '속초 등대 전망대',
          category: 'attraction',
          categoryDetail: '여행 > 관광명소',
          address: '강원특별자치도 속초시 영금정로 45',
          coordinates: { lat: 38.2115, lng: 128.5989 },
        },
      ]),
    },
    popularPlaces: { isAvailable: true, collect: jest.fn().mockResolvedValue([]) },
    embeddings: {
      embedWithSource: jest
        .fn()
        .mockResolvedValue({ vector: [1, 0], source: 'remote', remoteDimensions: 2 }),
      dimensions: jest.fn(() => 2),
    },
    repository: {
      deleteRegion: jest.fn().mockResolvedValue(0),
      findProvenance: jest.fn().mockResolvedValue(null),
      upsertPlace: jest.fn().mockResolvedValue(undefined),
      updateOpeningHours: jest.fn().mockResolvedValue(undefined),
    },
    cursors: { getNextOffset: jest.fn().mockResolvedValue(0), setNextOffset: jest.fn() },
  };
}

function build(deps: MockDeps): PlaceIngestionService {
  return new PlaceIngestionService(
    deps.config as never,
    deps.tourApi as never,
    deps.kakaoLocal as never,
    deps.popularPlaces as never,
    deps.embeddings as never,
    deps.repository as never,
    deps.cursors as never,
  );
}
