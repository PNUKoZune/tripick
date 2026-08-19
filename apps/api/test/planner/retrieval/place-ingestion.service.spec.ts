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
 * 소스가 달라 ID 가 다른 같은 장소가 실행마다 새 행으로 쌓이던 회귀를 막는다.
 * (한 실행 안의 dedupe 는 있었지만 DB 조회는 ID 로만 했다)
 */
describe('PlaceIngestionService 실행 간 중복', () => {
  it('같은 장소가 다른 소스 ID 로 이미 있으면 새 행을 만들지 않는다', async () => {
    const deps = mockDeps();
    deps.repository.findSamePlace.mockResolvedValue({ id: 'existing-1', openingHours: null });
    const service = build(deps);

    const summary = await service.ingest({
      regions: ['속초'],
      sources: ['kakao'],
      maxPerRegion: 4,
    });

    expect(deps.repository.upsertPlace).not.toHaveBeenCalled();
    expect(summary.totalDuplicates).toBe(1);
    expect(summary.totalInserted).toBe(0);
    // 임베딩 호출은 시작 전 헬스체크 1회뿐 — 중복 후보에는 벡터를 만들지 않는다.
    expect(deps.embeddings.embedWithSource).toHaveBeenCalledTimes(1);
  });

  it('중복이라도 기존 행에 없는 영업시간은 채운다 (재임베딩 없이)', async () => {
    const deps = mockDeps();
    deps.repository.findSamePlace.mockResolvedValue({ id: 'existing-1', openingHours: null });
    deps.tourApi.fetchByArea.mockResolvedValue({
      places: [
        {
          tourismApiId: 't-1',
          name: '속초시립박물관',
          category: 'attraction',
          address: '강원특별자치도 속초시 신흥2길 16',
          coordinates: { lat: 38.1934, lng: 128.6017 },
          region: '강원특별자치도',
          sigungu: '속초시',
          openingHours: '09:00-18:00',
          source: 'tour',
        },
      ],
      nextOffset: 0,
      quotaExceeded: false,
    });
    const service = build(deps);

    await service.ingest({ regions: ['강원'], sources: ['tour'], maxPerRegion: 4 });

    expect(deps.repository.updateOpeningHours).toHaveBeenCalledWith('existing-1', '09:00-18:00');
    expect(deps.repository.upsertPlace).not.toHaveBeenCalled();
  });

  it('한 실행 안에서도 반경 규칙으로 접는다 (좌표 버킷 경계에 걸린 쌍)', async () => {
    const deps = mockDeps();
    // 같은 이름·144m 차이. 소수 3자리 버킷 비교였을 땐 서로 다른 버킷이라 둘 다 통과했다.
    deps.kakaoLocal.searchAround.mockResolvedValue([
      kakaoDoc('k-1', 38.2115),
      kakaoDoc('k-2', 38.2128),
    ]);
    const service = build(deps);

    const summary = await service.ingest({
      regions: ['속초'],
      sources: ['kakao'],
      maxPerRegion: 4,
    });

    expect(summary.regions[0]!.deduped).toBe(1);
    expect(deps.repository.upsertPlace).toHaveBeenCalledTimes(1);
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

function kakaoDoc(kakaoPlaceId: string, lat: number) {
  return {
    kakaoPlaceId,
    name: '속초 등대 전망대',
    category: 'attraction',
    categoryDetail: '여행 > 관광명소',
    address: '강원특별자치도 속초시 영금정로 45',
    coordinates: { lat, lng: 128.5989 },
  };
}

/**
 * 검색 게이트가 후보로 절대 안 쓰는 행이 적재만 되고 쌓이던 회귀를 막는다.
 * 정리 CLI 로 걷어내도 재적재가 그대로 되돌려 놨다(부산 재적재 후 13건 재유입).
 */
describe('PlaceIngestionService 부적합 장소 차단', () => {
  it('검색이 안 쓰는 장소(의료 시설·SEO 상호)는 적재하지 않는다', async () => {
    // ⚠️ 소스 카테고리가 이름보다 우선한다 — 소스가 '관광명소' 로 준 것은 이름에 '약국' 이
    // 들어 있어도 통과한다('부산 구 백제병원' 같은 실제 명소를 살리기 위한 설계).
    const deps = mockDeps();
    deps.kakaoLocal.searchAround.mockResolvedValue([
      // 카카오는 약국에 '의료,건강 > 약국' 을 준다 — 게이트는 이름보다 이 값을 먼저 본다.
      { ...kakaoDoc('k-drug', 38.2115), name: '가까운약국', categoryDetail: '의료,건강 > 약국' },
      { ...kakaoDoc('k-seo', 38.2116), name: '속초맛집' },
      { ...kakaoDoc('k-ok', 38.2117), name: '속초 등대 전망대' },
    ]);
    const service = build(deps);

    const summary = await service.ingest({ regions: ['속초'], sources: ['kakao'], maxPerRegion: 8 });

    const upserted = deps.repository.upsertPlace.mock.calls.map((call) => (call[0] as { name: string }).name);
    expect(upserted).toEqual(['속초 등대 전망대']);
    expect(summary.totalInserted).toBe(1);
  });

  it('국내 좌표 밖(KTO placeholder)도 같은 게이트에서 막힌다', async () => {
    const deps = mockDeps();
    deps.kakaoLocal.searchAround.mockResolvedValue([
      { ...kakaoDoc('k-bad', 38.2115), name: '남중국해 좌표 장소', coordinates: { lat: 19.694, lng: 117.993 } },
    ]);
    const service = build(deps);

    const summary = await service.ingest({ regions: ['속초'], sources: ['kakao'], maxPerRegion: 8 });

    expect(deps.repository.upsertPlace).not.toHaveBeenCalled();
    expect(summary.totalInserted).toBe(0);
  });
});

/**
 * 카카오만 돌리는 실행이 지역 중심 1곳으로 떨어져 시도 전역을 못 훑던 회귀를 막는다.
 * (KTO 일 한도를 다 쓴 날에도 카카오 단독 보강이 되어야 한다)
 */
describe('PlaceIngestionService 카카오 앵커', () => {
  it('이번 실행에 앵커가 없으면 카탈로그 좌표에서 뽑는다 (지역 중심 폴백 금지)', async () => {
    const deps = mockDeps();
    // 서로 다른 0.1° 버킷 3곳 — 앵커 3곳이 나와야 한다.
    deps.repository.findRegionCoordinates.mockResolvedValue([
      { lat: 38.21, lng: 128.59 },
      { lat: 37.55, lng: 126.98 },
      { lat: 35.16, lng: 129.16 },
    ]);
    const service = build(deps);

    await service.ingest({ regions: ['강원'], sources: ['kakao'], maxPerRegion: 40 });

    expect(deps.kakaoLocal.resolveCenter).not.toHaveBeenCalled();
    expect(deps.kakaoLocal.searchAround).toHaveBeenCalledTimes(3);
  });

  it('이번 실행 앵커를 앞에 두고 남은 슬롯만 카탈로그로 채운다', async () => {
    const deps = mockDeps();
    deps.config.get = jest.fn((key: string, fallback?: unknown) =>
      key === 'KAKAO_INGEST_MAX_ANCHORS' ? 2 : fallback,
    );
    deps.tourApi.fetchByArea.mockResolvedValue({
      places: [
        {
          tourismApiId: 't-1',
          name: '속초시립박물관',
          category: 'attraction',
          address: '강원특별자치도 속초시 신흥2길 16',
          coordinates: { lat: 38.19, lng: 128.6 },
          region: '강원특별자치도',
          source: 'tour',
        },
      ],
      nextOffset: 0,
      quotaExceeded: false,
    });
    // 첫 좌표는 이번 실행 앵커와 반경 절반(5km) 안이라 버려지고, 먼 쪽이 남은 슬롯을 채운다.
    deps.repository.findRegionCoordinates.mockResolvedValue([
      { lat: 38.192, lng: 128.601 },
      { lat: 37.55, lng: 126.98 },
    ]);
    const service = build(deps);

    await service.ingest({ regions: ['강원'], sources: ['tour', 'kakao'], maxPerRegion: 40 });

    const centers = deps.kakaoLocal.searchAround.mock.calls.map((call) => call[0]);
    expect(centers).toEqual([
      { lat: 38.19, lng: 128.6 },
      { lat: 37.55, lng: 126.98 },
    ]);
  });

  it('반경을 줄이면 앵커 격자도 같이 촘촘해진다', async () => {
    // 약 5km 떨어진 두 좌표. 반경 10km(격자 0.1°) 에선 한 버킷이라 앵커가 1곳이지만,
    // 반경 3km(격자 0.03°) 에선 서로 다른 버킷이라 2곳이 나와야 한다 — 격자가 반경에
    // 안 따라오면 앵커 사이가 통째로 안 걷힌다.
    const coordinates = [
      { lat: 35.16, lng: 129.06 },
      { lat: 35.2, lng: 129.09 },
    ];

    const wide = mockDeps();
    wide.repository.findRegionCoordinates.mockResolvedValue(coordinates);
    await build(wide).ingest({ regions: ['부산'], sources: ['kakao'], maxPerRegion: 40 });
    expect(wide.kakaoLocal.searchAround).toHaveBeenCalledTimes(1);

    const tight = mockDeps();
    tight.config.get = jest.fn((key: string, fallback?: unknown) =>
      key === 'KAKAO_INGEST_RADIUS_M' ? 3000 : fallback,
    );
    tight.repository.findRegionCoordinates.mockResolvedValue(coordinates);
    await build(tight).ingest({ regions: ['부산'], sources: ['kakao'], maxPerRegion: 40 });
    expect(tight.kakaoLocal.searchAround).toHaveBeenCalledTimes(2);
  });

  it('카탈로그도 비면 지역 중심 1곳으로 폴백한다', async () => {
    const deps = mockDeps();
    const service = build(deps);

    await service.ingest({ regions: ['강원'], sources: ['kakao'], maxPerRegion: 40 });

    expect(deps.kakaoLocal.resolveCenter).toHaveBeenCalledWith('강원특별자치도');
    expect(deps.kakaoLocal.searchAround).toHaveBeenCalledTimes(1);
  });
});

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
      searchAround: jest.fn().mockResolvedValue([kakaoDoc('k-1', 38.2115)]),
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
      findSamePlace: jest.fn().mockResolvedValue(null),
      findRegionCoordinates: jest.fn().mockResolvedValue([]),
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
