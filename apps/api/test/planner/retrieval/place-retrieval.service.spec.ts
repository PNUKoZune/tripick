/// <reference types="jest" />

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

/** 총 `total` 건 중 `dining` 건이 식당인 후보 풀. */
function pool(total: number, dining: number, prefix = 'p'): RawPlaceCandidate[] {
  return Array.from({ length: total }, (_, index) => ({
    ...candidate(`${prefix}-${index}`, `장소${index}`, '여행 > 관광지'),
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
