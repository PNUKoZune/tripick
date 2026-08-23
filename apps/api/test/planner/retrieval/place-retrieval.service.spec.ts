/// <reference types="jest" />

import { Logger } from '@nestjs/common';
import { PlaceRetrievalService } from '../../../src/planner/retrieval/place-retrieval.service';
import { DEFAULT_TERM_WEIGHTS } from '../../../src/planner/retrieval/retrieval-rank';
import type { CandidatePlace, RawPlaceCandidate } from '../../../src/planner/retrieval/types';

describe('PlaceRetrievalService candidate eligibility', () => {
  it('filters a high-scoring clinic from pgvector before CRAG ranking', async () => {
    const hospital = candidate('clinic-1', '부산365한의원', '의료,건강 > 한의원');
    const museum = candidate('museum-1', '부산현대미술관', '여행 > 문화시설 > 미술관');
    const rank = jest.fn((places: RawPlaceCandidate[]) => places.map(ranked));
    const evaluator = {
      rank,
      selectTopDiverse: jest.fn((places: CandidatePlace[], limit: number) =>
        places.slice(0, limit),
      ),
      // accept 게이트의 인지도 감점 되돌림이 실효 가중치를 evaluator 에 되묻는다.
      weights: jest.fn(() => DEFAULT_TERM_WEIGHTS),
    };
    const service = new PlaceRetrievalService(
      config({ PLACE_RETRIEVAL_AUTO_SEED: 'false' }),
      { embed: jest.fn().mockResolvedValue([1, 0]) } as any,
      { searchByEmbedding: jest.fn().mockResolvedValue([hospital, museum]) } as any,
      { search: jest.fn().mockResolvedValue([]) } as any,
      evaluator as any,
      { getPopularityIndex: jest.fn().mockResolvedValue(disabledPopularityIndex()) } as any,
      { resolve: jest.fn().mockResolvedValue(null) } as any,
    );

    const result = await service.retrieve({
      userId: 'user-1',
      destination: '부산',
      limit: 4,
      startAt: new Date('2026-07-10T00:00:00.000Z'),
    });

    expect(rank).toHaveBeenCalled();
    expect(rank.mock.calls.flatMap(([places]) => places).map((place) => place.id)).not.toContain(
      hospital.id,
    );
    expect(result.places.map((place) => place.id)).not.toContain(hospital.id);
  });
});

describe('PlaceRetrievalService 지역 하드 게이트', () => {
  /** 카카오 폴백을 태우기 위해 pgvector 를 비운다(풀이 얇아야 폴백이 돈다). */
  function buildWithKakao(kakaoResults: RawPlaceCandidate[]) {
    const evaluator = {
      rank: jest.fn((places: RawPlaceCandidate[]) => places.map(ranked)),
      selectTopDiverse: jest.fn((places: CandidatePlace[], limit: number) => places.slice(0, limit)),
      weights: jest.fn(() => DEFAULT_TERM_WEIGHTS),
    };
    const kakaoSearch = jest.fn().mockResolvedValue(kakaoResults);
    const service = new PlaceRetrievalService(
      config({ PLACE_RETRIEVAL_AUTO_SEED: 'false' }),
      { embed: jest.fn().mockResolvedValue([1, 0]) } as any,
      { searchByEmbedding: jest.fn().mockResolvedValue([]), countRegionCandidates: jest.fn() } as any,
      { search: kakaoSearch } as any,
      evaluator as any,
      { getPopularityIndex: jest.fn().mockResolvedValue(disabledPopularityIndex()) } as any,
      { resolve: jest.fn().mockResolvedValue(null) } as any,
    );
    return { service, kakaoSearch };
  }

  it('다른 지역 후보를 후보 풀에서 뺀다', async () => {
    // 카카오 키워드 폴백은 좌표를 안 주면 전국이 사정권 — '경주 맛집' 이 단양의 '경주식당'을
    // 물어온다. CRAG 감점(0.32)만으로는 풀이 얇을 때 그대로 살아남아 이동 457분을 만든다.
    const { service } = buildWithKakao([
      regionalCandidate('near-1', '황리단길', '경상북도 경주시 포석로 1080'),
      regionalCandidate('far-1', '경주식당', '충청북도 단양군 단양읍 도전6길 14'),
    ]);

    const result = await service.retrieve({ userId: 'u1', destination: '경주', limit: 4 });

    const names = result.places.map((place) => place.name);
    expect(names).toContain('황리단길');
    expect(names).not.toContain('경주식당');
  });

  it('지역을 못 읽는 후보는 남긴다 (데이터 없음 ≠ 다른 지역)', async () => {
    const { service } = buildWithKakao([
      regionalCandidate('near-1', '황리단길', '경상북도 경주시 포석로 1080'),
      regionless('unknown-1', '이름만 있는 곳'),
    ]);

    const result = await service.retrieve({ userId: 'u1', destination: '경주', limit: 4 });

    expect(result.places.map((place) => place.name)).toContain('이름만 있는 곳');
  });

  it('한 건도 안 맞으면 게이트를 포기한다', async () => {
    // destinationRegionFilter 는 임의 문자열에서도 시군구 코드를 만든다('발리' → '발리').
    // 그대로 두면 전부 탈락해 후보가 0 이 된다.
    const { service } = buildWithKakao([
      regionalCandidate('a', '발리 어딘가', '경상북도 경주시 포석로 1080'),
    ]);

    const result = await service.retrieve({ userId: 'u1', destination: '발리', limit: 4 });

    expect(result.places.map((place) => place.name)).toContain('발리 어딘가');
  });
});

function regionalCandidate(id: string, name: string, address: string): RawPlaceCandidate {
  return { ...candidate(id, name, '여행 > 관광지'), address };
}

/** 주소·지역 라벨이 둘 다 없는 후보 — 지역을 판정할 수 없는 행. */
function regionless(id: string, name: string): RawPlaceCandidate {
  const { destinationRegion: _omit, ...rest } = candidate(id, name, '여행 > 관광지');
  return { ...rest, address: '' };
}

describe('PlaceRetrievalService anchor scope', () => {
  const anchor = {
    coordinates: { lat: 35.1532, lng: 129.119 },
    label: '광안리해수욕장',
    region: { sido: '부산' as const, sigungu: '수영' },
  };

  it('후보가 얇으면 반경을 넓혀 다시 훑는다', async () => {
    // 실측에서 광안리 2km 는 17건이나 되지만 식당·카페가 2곳뿐이라 식사 슬롯을 못 채운다.
    const searchByEmbedding = jest
      .fn()
      .mockResolvedValueOnce(pool(3, 1))
      .mockResolvedValueOnce(pool(10, 4));
    const { service } = buildService({ anchor, searchByEmbedding });

    const result = await service.retrieve({ userId: 'u1', destination: '광안리', limit: 4 });

    const scopes = searchByEmbedding.mock.calls.map(([, scope]) => scope);
    expect(scopes).toEqual([
      { kind: 'anchor', center: anchor.coordinates, radiusM: 2000 },
      { kind: 'anchor', center: anchor.coordinates, radiusM: 5000 },
    ]);
    expect(result.places).toHaveLength(4);
  });

  it('최대 반경으로도 못 채우면 지역 전역을 덧댄다 (교체가 아니라 합집합)', async () => {
    // 에버랜드처럼 카탈로그가 얇은 앵커. 가까운 후보를 지역 상위 N 경쟁에 밀려 잃으면
    // 앵커를 쓴 의미가 없다.
    const near = pool(2, 1, 'near');
    const regional = pool(8, 4, 'far');
    const searchByEmbedding = jest
      .fn()
      .mockResolvedValueOnce(near)
      .mockResolvedValueOnce(near)
      .mockResolvedValueOnce(near)
      .mockResolvedValueOnce(regional);
    const { service } = buildService({ anchor, searchByEmbedding });

    const result = await service.retrieve({ userId: 'u1', destination: '광안리', limit: 4 });

    expect(searchByEmbedding).toHaveBeenCalledTimes(4);
    expect(searchByEmbedding.mock.calls[3]![1]).toEqual({ kind: 'region', region: anchor.region });
    expect(result.trace.sources).toEqual(['pgvector']);
    // 가까운 후보가 지역 후보에 밀려 사라지지 않았는지
    expect(result.places.map((place) => place.id)).toContain('near-0');
  });

  it('개수가 충분해도 카페가 0건이면 반경을 넓힌다', async () => {
    // 카탈로그가 관광지 27,436 : 음식점 15,854 : 카페 2,591 이라, 식음을 한 덩어리로 세면
    // 음식점만으로 하한이 채워져 카페 0건인 반경에서 멈춘다 — 일정에 카페가 안 들어오던 원인.
    const searchByEmbedding = jest
      .fn()
      .mockResolvedValueOnce(poolWithoutCafe(12, 5))
      .mockResolvedValueOnce(pool(12, 5));
    const { service } = buildService({ anchor, searchByEmbedding });

    await service.retrieve({ userId: 'u1', destination: '광안리', limit: 4 });

    expect(searchByEmbedding.mock.calls.map(([, scope]) => scope.radiusM)).toEqual([2000, 5000]);
  });

  it('앵커가 있으면 서울 좌표 폴백 시드를 섞지 않는다', async () => {
    // getSeedCandidates 는 전용 카탈로그가 없는 목적지에 DEFAULT_SEEDS(서울 도심 좌표의
    // 가짜 장소 6개)를 준다. 부산 일정에 그게 박히면 동선이 통째로 깨진다.
    const searchByEmbedding = jest.fn().mockResolvedValue(pool(2, 1));
    const { service } = buildService({ anchor, searchByEmbedding });

    const result = await service.retrieve({ userId: 'u1', destination: '광안리', limit: 4 });

    expect(result.trace.sources).not.toContain('seed');
  });

  it('앵커가 없으면 시드 폴백은 그대로 돈다', async () => {
    const searchByEmbedding = jest.fn().mockResolvedValue(pool(2, 1));
    const { service } = buildService({ anchor: null, searchByEmbedding });

    const result = await service.retrieve({ userId: 'u1', destination: '광안리', limit: 4 });

    expect(result.trace.sources).toContain('seed');
  });
});

/**
 * 총 `total` 건 중 `dining` 건이 식음인 후보 풀. 식음의 마지막 한 건은 카페다 —
 * 반경 판정이 카페를 따로 세므로(카탈로그 비중이 1/6 이라 음식점만으로 채워지면 안 된다)
 * 픽스처도 음식점만으로 이뤄지면 실제와 다른 상황을 재현하게 된다.
 */
/**
 * 얇은 풀은 조용히 짧은 일정이 된다 — 정상 로그의 `selected=` 만으로는 그게 정상인지 부족인지
 * 구분이 안 됐다. 요청치·종류별 하한과 나란히 찍어 운영이 원인을 가를 수 있게 한다.
 */
describe('PlaceRetrievalService 얇은 풀 경고', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('요청한 수를 못 채우면 요청치와 종류별 구성을 남긴다', async () => {
    // 시드 표본이 없는 목적지 — '부산' 같은 시드 지역은 얇은 풀이 시드로 메워져 경고가 안 뜬다.
    const searchByEmbedding = jest.fn().mockResolvedValueOnce(pool(3, 2)).mockResolvedValue([]);
    const { service } = buildService({ anchor: null, searchByEmbedding });

    await service.retrieve({ userId: 'u1', destination: '울릉도', limit: 12 });

    expect(thinPoolWarning(warn)).toContain('9/12건');
    // 얇은 풀은 시드 표본으로 메워진다 — 그 사실이 같이 남아야 9건을 건강한 풀로 오독하지 않는다.
    expect(thinPoolWarning(warn)).toContain('시드 표본으로 메움');
  });

  it('개수가 차도 종류별 하한을 못 맞추면 그 종류를 짚는다', async () => {
    // 카페 0건 — 개수(6)는 limit 을 채우지만 하루 카페 자리가 안 나온다.
    const searchByEmbedding = jest.fn().mockResolvedValue(poolWithoutCafe(6, 2));
    const { service } = buildService({ anchor: null, searchByEmbedding });

    await service.retrieve({
      userId: 'u1',
      destination: '부산',
      limit: 6,
      categoryQuota: { restaurant: 2, cafe: 1, attraction: 2 },
    });

    expect(thinPoolWarning(warn)).toContain('cafe 0/1');
  });

  it('요청치와 하한을 다 채우면 조용하다', async () => {
    const searchByEmbedding = jest.fn().mockResolvedValue(pool(6, 2));
    const { service } = buildService({ anchor: null, searchByEmbedding });

    await service.retrieve({
      userId: 'u1',
      destination: '부산',
      limit: 6,
      categoryQuota: { restaurant: 1, cafe: 1, attraction: 2 },
    });

    expect(thinPoolWarning(warn)).toBeUndefined();
  });
});

function thinPoolWarning(warn: jest.SpyInstance): string | undefined {
  return warn.mock.calls
    .map((call) => String(call[0]))
    .find((message) => message.includes('후보 풀 부족'));
}

function pool(total: number, dining: number, prefix = 'p'): RawPlaceCandidate[] {
  return Array.from({ length: total }, (_, index) => ({
    ...candidate(`${prefix}-${index}`, `장소${index}`, '여행 > 관광지'),
    category: index < dining ? (index === dining - 1 ? 'cafe' : 'restaurant') : 'attraction',
  }));
}

/** 식음이 전부 음식점인 후보 풀 (카페 0건). */
function poolWithoutCafe(total: number, dining: number): RawPlaceCandidate[] {
  return pool(total, dining).map((place, index) => ({
    ...place,
    category: index < dining ? 'restaurant' : 'attraction',
  }));
}

function buildService(options: {
  anchor: {
    coordinates: { lat: number; lng: number };
    label: string;
    region: { sido: string | null; sigungu: string | null };
  } | null;
  searchByEmbedding: jest.Mock;
}) {
  const evaluator = {
    rank: jest.fn((places: RawPlaceCandidate[]) => places.map(ranked)),
    selectTopDiverse: jest.fn((places: CandidatePlace[], limit: number) => places.slice(0, limit)),
    weights: jest.fn(() => DEFAULT_TERM_WEIGHTS),
  };
  const service = new PlaceRetrievalService(
    config({}),
    { embed: jest.fn().mockResolvedValue([1, 0]) } as any,
    { searchByEmbedding: options.searchByEmbedding, countRegionCandidates: jest.fn() } as any,
    { search: jest.fn().mockResolvedValue([]) } as any,
    evaluator as any,
    { getPopularityIndex: jest.fn().mockResolvedValue(disabledPopularityIndex()) } as any,
    { resolve: jest.fn().mockResolvedValue(options.anchor) } as any,
  );
  return { service, evaluator };
}

function candidate(id: string, name: string, categoryDetail: string): RawPlaceCandidate {
  return {
    id,
    name,
    category: 'attraction',
    categoryDetail,
    address: '부산광역시',
    coordinates: { lat: 35.17, lng: 129.07 },
    source: 'pgvector',
    similarity: 0.95,
    tags: ['city'],
    destinationRegion: 'busan',
  };
}

function ranked(place: RawPlaceCandidate): CandidatePlace {
  return {
    ...place,
    tags: place.tags ?? [],
    confidence: 0.9,
    reason: 'fixture',
    crag: {
      total: 0.9,
      retrieval: 0.9,
      taste: 0.9,
      locality: 0.9,
      context: 0.9,
      availability: 0.9,
      popularity: 0.5,
      matchedTags: [],
      penalties: [],
    },
  };
}

function disabledPopularityIndex() {
  return { docCount: 0, mentions: () => 0, score: () => 0.5 };
}

function config(values: Record<string, string>) {
  return {
    get<T = string>(key: string, fallback?: T): T {
      return (values[key] ?? fallback) as T;
    },
  } as any;
}
