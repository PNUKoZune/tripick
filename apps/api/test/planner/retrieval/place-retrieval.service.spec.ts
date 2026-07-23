/// <reference types="jest" />

import { PlaceRetrievalService } from '../../../src/planner/retrieval/place-retrieval.service';
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
    };
    const service = new PlaceRetrievalService(
      config({ PLACE_RETRIEVAL_AUTO_SEED: 'false' }),
      { embed: jest.fn().mockResolvedValue([1, 0]) } as any,
      { searchByEmbedding: jest.fn().mockResolvedValue([hospital, museum]) } as any,
      { search: jest.fn().mockResolvedValue([]) } as any,
      evaluator as any,
      { getPopularityIndex: jest.fn().mockResolvedValue(disabledPopularityIndex()) } as any,
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
      dataQuality: 0.9,
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
