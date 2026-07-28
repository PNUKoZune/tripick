/// <reference types="jest" />

import { CragEvaluatorService } from '../../../src/planner/retrieval/crag-evaluator.service';
import type { CandidatePlace, RawPlaceCandidate, RetrievalContext } from '../../../src/planner/retrieval/types';

describe('CragEvaluatorService', () => {
  const service = new CragEvaluatorService();

  const busanContext: RetrievalContext = {
    userId: 'user-1',
    destination: '부산',
    trigger: 'manual',
    tasteTags: {
      food: ['cafe'],
      mood: ['romantic'],
      environment: ['beach'],
      confidence: 0.9,
    },
  };

  it('ranks candidates by retrieval quality, taste match, locality, and event fit', () => {
    const candidates: RawPlaceCandidate[] = [
      {
        id: 'wrong-region',
        name: '성수 감도 카페',
        category: 'cafe',
        address: '서울 성동구 연무장길 45',
        coordinates: { lat: 37.5441, lng: 127.0541 },
        source: 'pgvector',
        similarity: 0.93,
        tags: ['cafe', 'city', 'healing'],
        destinationRegion: 'seoul',
      },
      {
        id: 'right-region',
        name: '광안리 브런치 카페',
        category: 'cafe',
        address: '부산 수영구 광안해변로 219',
        coordinates: { lat: 35.1532, lng: 129.1185 },
        source: 'pgvector',
        similarity: 0.86,
        tags: ['cafe', 'beach', 'romantic'],
        destinationRegion: 'busan',
      },
    ];

    const ranked = service.rank(candidates, busanContext);

    expect(ranked[0]!.id).toBe('right-region');
    expect(ranked[0]!.crag.matchedTags).toEqual(['cafe', 'beach', 'romantic']);
    expect(ranked[1]!.crag.penalties).toContain('destination-mismatch');
  });

  it('treats newly added dining/onsen tags as indoor on weather reroute', () => {
    // 확장된 어휘(seafood·hotspring 등)도 실내 후보로 대접받아야 비 오는 날 우선된다.
    const weatherContext: RetrievalContext = {
      userId: 'user-1',
      destination: '부산',
      trigger: 'weather',
      tasteTags: { food: ['korean'], mood: ['healing'], environment: ['nature'], confidence: 0.5 },
    };
    const indoor: RawPlaceCandidate = {
      id: 'indoor',
      name: '실내 후보',
      category: 'restaurant',
      address: '부산 수영구 어딘가로 1',
      coordinates: { lat: 35.15, lng: 129.11 },
      source: 'seed',
      tags: ['seafood'],
      destinationRegion: 'busan',
    };
    const outdoor: RawPlaceCandidate = {
      ...indoor,
      id: 'outdoor',
      name: '실외 후보',
      tags: ['beach'],
    };

    const ranked = service.rank([outdoor, indoor], weatherContext);

    expect(ranked[0]!.id).toBe('indoor');
    expect(ranked[0]!.confidence).toBeGreaterThan(ranked[1]!.confidence);
  });

  it('같은 장소를 가리키는 근접 중복 후보를 접고 자리를 비운다', () => {
    // 실측: 제주 상위 16칸 중 1·2위가 둘 다 '한라산'(다른 kakao id, 1.9km) 이었다.
    const jeju: RetrievalContext = { userId: 'user-1', destination: '제주', trigger: 'manual' };
    const ranked = service.rank(
      [
        {
          id: 'hallasan-a',
          name: '한라산',
          category: 'attraction',
          address: '제주특별자치도 제주시 오등동 산 182',
          coordinates: { lat: 33.37666, lng: 126.54244 },
          source: 'pgvector',
          similarity: 0.78,
          destinationRegion: '제주도',
        },
        {
          id: 'hallasan-b',
          name: '한라산',
          category: 'attraction',
          address: '제주특별자치도 서귀포시 서홍동 산 1-1',
          coordinates: { lat: 33.36142, lng: 126.52942 },
          source: 'pgvector',
          similarity: 0.77,
          destinationRegion: '제주도',
        },
        {
          id: 'bijarim',
          name: '비자림',
          category: 'attraction',
          address: '제주특별자치도 제주시 구좌읍 비자숲길 55',
          coordinates: { lat: 33.4899, lng: 126.8135 },
          source: 'pgvector',
          similarity: 0.76,
          destinationRegion: '제주도',
        },
      ],
      jeju,
    );

    expect(ranked.map((candidate) => candidate.id)).toEqual(['hallasan-a', 'bijarim']);
  });

  it('keeps selected candidates diverse before filling the rest', () => {
    const ranked = service.rank(
      [
        ...Array.from({ length: 4 }, (_, index) => ({
          id: `cafe-${index}`,
          name: `부산 카페 ${index}`,
          category: 'cafe',
          address: '부산 수영구 광안해변로 219',
          coordinates: { lat: 35.1532 + index * 0.001, lng: 129.1185 },
          source: 'seed' as const,
          tags: ['cafe', 'beach', 'romantic'],
          destinationRegion: 'busan',
        })),
        {
          id: 'museum',
          name: '부산현대미술관',
          category: 'attraction',
          address: '부산 사하구 낙동남로 1191',
          coordinates: { lat: 35.1049, lng: 128.9668 },
          source: 'seed' as const,
          tags: ['cultural', 'city', 'family'],
          destinationRegion: 'busan',
        },
      ],
      busanContext,
    );

    const selected = service.selectTopDiverse(ranked, 4);

    expect(selected.some((candidate) => candidate.category === 'attraction')).toBe(true);
    expect(selected.filter((candidate) => candidate.category === 'cafe')).toHaveLength(3);
  });

  it('reranks by stored preference vector similarity when available', () => {
    const base: RawPlaceCandidate = {
      id: 'a',
      name: '광안리 브런치 카페',
      category: 'cafe',
      address: '부산 수영구 광안해변로 219',
      coordinates: { lat: 35.1532, lng: 129.1185 },
      source: 'pgvector',
      similarity: 0.85,
      tags: ['cafe', 'beach', 'romantic'],
      destinationRegion: 'busan',
    };

    const highPref = service.rank([{ ...base, preferenceSimilarity: 0.95 }], busanContext)[0]!;
    const lowPref = service.rank([{ ...base, preferenceSimilarity: -0.5 }], busanContext)[0]!;

    expect(highPref.crag.personalization).toBeGreaterThan(lowPref.crag.personalization!);
    expect(highPref.crag.taste).toBeGreaterThan(lowPref.crag.taste);
    expect(highPref.confidence).toBeGreaterThan(lowPref.confidence);
  });

  it('weights tag matching by photo-analysis confidence', () => {
    const candidate: RawPlaceCandidate = {
      id: 'matched-cafe',
      name: '광안리 브런치 카페',
      category: 'cafe',
      address: '부산 수영구 광안해변로 219',
      coordinates: { lat: 35.1532, lng: 129.1185 },
      source: 'pgvector',
      similarity: 0.8,
      tags: ['cafe', 'beach', 'romantic'],
      destinationRegion: 'busan',
    };

    const highConfidence = service.rank([candidate], busanContext)[0]!;
    const lowConfidence = service.rank([candidate], {
      ...busanContext,
      tasteTags: { ...busanContext.tasteTags!, confidence: 0.4 },
    })[0]!;

    expect(highConfidence.crag.taste).toBeGreaterThan(lowConfidence.crag.taste);
    expect(highConfidence.confidence).toBeGreaterThan(lowConfidence.confidence);
  });

  it('ignores matched tags below the actionable confidence threshold', () => {
    const ranked = service.rank(
      [
        {
          id: 'uncertain-cafe',
          name: '광안리 브런치 카페',
          category: 'cafe',
          address: '부산 수영구 광안해변로 219',
          coordinates: { lat: 35.1532, lng: 129.1185 },
          source: 'seed',
          tags: ['cafe', 'beach', 'romantic'],
          destinationRegion: 'busan',
        },
      ],
      {
        ...busanContext,
        tasteTags: { ...busanContext.tasteTags!, confidence: 0.2 },
      },
    );

    expect(ranked[0]!.crag.matchedTags).toEqual([]);
    expect(ranked[0]!.crag.taste).toBe(0.56);
  });

  it('demotes a place unmentioned in Naver recommendations below a mentioned twin', () => {
    const twin = (id: string, name: string): RawPlaceCandidate => ({
      id,
      name,
      category: 'cafe',
      address: '부산 수영구 광안해변로 219',
      coordinates: { lat: 35.1532, lng: 129.1185 },
      source: 'pgvector',
      similarity: 0.88,
      tags: ['cafe', 'beach', 'romantic'],
      destinationRegion: 'busan',
    });
    // 두 후보는 유명세만 다르다: '광안리'는 추천 글에 있고 '무명'은 없다.
    const popularityIndex = {
      docCount: 4,
      mentions: (name: string) => (name.includes('광안리') ? 5 : 0),
      score: (name: string) => (name.includes('광안리') ? 0.87 : 0.15),
    };

    const ranked = service.rank(
      [twin('minor', '무명 골목 카페'), twin('famous', '광안리 브런치 카페')],
      { ...busanContext, popularityIndex },
    );

    expect(ranked[0]!.id).toBe('famous');
    expect(ranked.find((c) => c.id === 'minor')!.crag.penalties).toContain('naver-unmentioned');
  });

  it('leaves ranking unchanged when no popularity index is provided (neutral)', () => {
    const candidate: RawPlaceCandidate = {
      id: 'c1',
      name: '광안리 브런치 카페',
      category: 'cafe',
      address: '부산 수영구 광안해변로 219',
      coordinates: { lat: 35.1532, lng: 129.1185 },
      source: 'pgvector',
      similarity: 0.86,
      tags: ['cafe', 'beach', 'romantic'],
      destinationRegion: 'busan',
    };

    const ranked = service.rank([candidate], busanContext);
    expect(ranked[0]!.crag.popularity).toBe(0.5);
    expect(ranked[0]!.crag.penalties).not.toContain('naver-unmentioned');
  });

  /**
   * 예전 구현은 다양성 상한에 걸린 후보를 건너뛴 채 limit 을 채우고 반환해 **버렸다**.
   * 제주 실측에서 점수 3위 한라산·5위 비자림이 사라지고 더 낮은 점수가 그 자리에 들어왔다.
   */
  describe('selectTopDiverse', () => {
    function candidate(id: string, category: string, confidence: number): CandidatePlace {
      return {
        id,
        name: id,
        category,
        address: '서울 어딘가',
        coordinates: { lat: 37.5, lng: 127 },
        source: 'pgvector',
        tags: [],
        confidence,
        reason: '',
        crag: {
          total: confidence,
          retrieval: 0,
          taste: 0,
          locality: 0,
          context: 0,
          availability: 0,
          dataQuality: 0,
          popularity: 0,
          matchedTags: [],
          penalties: [],
        },
      } as CandidatePlace;
    }

    it('한 카테고리가 쏠려도 고득점 후보를 버리지 않는다', () => {
      const candidates = [
        ...Array.from({ length: 8 }, (_, i) => candidate(`a${i}`, 'attraction', 0.9 - i * 0.01)),
        candidate('c0', 'cafe', 0.5),
        candidate('r0', 'restaurant', 0.49),
      ];

      const selected = service.selectTopDiverse(candidates, 6);

      // 점수 상위 4개 관광지가 카페·식당보다 앞에 남아야 한다.
      expect(selected.slice(0, 4).map((c) => c.id)).toEqual(['a0', 'a1', 'a2', 'a3']);
      expect(selected).toHaveLength(6);
    });

    it('점수만으로 뽑으면 없을 종류를 최소 보유량만큼 채운다', () => {
      const candidates = [
        ...Array.from({ length: 6 }, (_, i) => candidate(`a${i}`, 'attraction', 0.9 - i * 0.01)),
        candidate('c0', 'cafe', 0.3),
        candidate('r0', 'restaurant', 0.29),
      ];

      const selected = service.selectTopDiverse(candidates, 6);

      // 식음 후보가 점수로는 밖이지만 일정에 식사 슬롯이 필요하므로 꼬리 자리를 받는다.
      const dining = selected.filter((c) => c.category === 'cafe' || c.category === 'restaurant');
      expect(dining).toHaveLength(2);
      // 내주는 자리는 꼬리부터 — 최상위는 그대로.
      expect(selected[0]!.id).toBe('a0');
      expect(selected).toHaveLength(6);
    });

    it('한 종류만 있으면 있는 것만 돌려준다 (억지로 못 채운다)', () => {
      const candidates = Array.from({ length: 4 }, (_, i) =>
        candidate(`a${i}`, 'attraction', 0.9 - i * 0.01),
      );
      expect(service.selectTopDiverse(candidates, 4).map((c) => c.id)).toEqual([
        'a0',
        'a1',
        'a2',
        'a3',
      ]);
    });
  });
});