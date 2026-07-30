/// <reference types="jest" />

import type { ConfigService } from '@nestjs/config';
import { CragEvaluatorService } from '../../../src/planner/retrieval/crag-evaluator.service';
import { DEFAULT_RETRIEVAL_WEIGHT } from '../../../src/planner/retrieval/retrieval-rank';
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

  /**
   * 영업시간 항은 감점 전용이다 — "데이터가 있다"에 가점하면 그건 장소 품질이 아니라
   * 데이터 출처(KTO 관광지)에 붙는 가점이고, 카카오 전용 식당·카페는 영업시간을 영구히 못 얻어
   * 체계적으로 후순위가 된다.
   */
  describe('availability 감점 전용', () => {
    const withHours = (id: string, openingHours?: string): RawPlaceCandidate => ({
      id,
      name: `부산 후보 ${id}`,
      category: 'attraction',
      address: '부산 수영구 광안해변로 219',
      coordinates: { lat: 35.1532, lng: 129.1185 },
      source: 'pgvector',
      similarity: 0.52,
      tags: ['beach'],
      destinationRegion: 'busan',
      ...(openingHours ? { openingHours } : {}),
    });

    /** 2026-08-01 10:00 KST */
    const visitAt = new Date('2026-08-01T01:00:00.000Z');

    it('영업시간이 있고 열려 있어도 판정 불가 후보와 같은 점수 (출처 가점 없음)', () => {
      const ranked = service.rank([withHours('open', '09:00-18:00'), withHours('unknown')], {
        ...busanContext,
        startAt: visitAt,
      });

      const open = ranked.find((c) => c.id === 'open')!;
      const unknown = ranked.find((c) => c.id === 'unknown')!;
      expect(open.crag.availability).toBe(unknown.crag.availability);
      expect(open.confidence).toBe(unknown.confidence);
      expect(open.crag.penalties).not.toContain('closed-at-target-time');
    });

    it('확인된 닫힘만 감점한다', () => {
      const ranked = service.rank([withHours('closed', '19:00-23:00'), withHours('unknown')], {
        ...busanContext,
        startAt: visitAt,
      });

      const closed = ranked.find((c) => c.id === 'closed')!;
      const unknown = ranked.find((c) => c.id === 'unknown')!;
      expect(closed.crag.availability).toBeLessThan(unknown.crag.availability);
      expect(closed.crag.penalties).toContain('closed-at-target-time');
      expect(ranked[0]!.id).toBe('unknown');
    });

    it('방문 시각이 없으면 영업시간이 있어도 중립 — 후보 95%의 값과 같아야 게이트가 안 흔들린다', () => {
      const [withData, withoutData] = [
        service.rank([withHours('open', '09:00-18:00')], busanContext)[0]!,
        service.rank([withHours('unknown')], busanContext)[0]!,
      ];
      expect(withData.crag.availability).toBe(withoutData.crag.availability);
    });
  });

  /**
   * retrieval 가중은 실측 근거로 0.24 → 0.06 으로 내렸다(`retrieval-rank.ts` 주석).
   * 스윕 노브가 게이트를 흔들지 않는지 — 즉 남은 몫이 비례 배분되는지 — 를 서비스 경로에서 확인한다.
   */
  it('CRAG_RETRIEVAL_WEIGHT 를 바꿔도 confidence 수준은 유지된다 (합 1 비례 배분)', () => {
    const withWeight = (value: string): CragEvaluatorService =>
      new CragEvaluatorService({
        get: (key: string) => (key === 'CRAG_RETRIEVAL_WEIGHT' ? value : undefined),
      } as unknown as ConfigService);

    const candidate: RawPlaceCandidate = {
      id: 'c1',
      name: '광안리 브런치 카페',
      category: 'cafe',
      address: '부산 수영구 광안해변로 219',
      coordinates: { lat: 35.1532, lng: 129.1185 },
      source: 'pgvector',
      similarity: 0.52,
      tags: ['cafe', 'beach', 'romantic'],
      destinationRegion: 'busan',
    };

    const low = withWeight('0.06').rank([candidate], busanContext)[0]!;
    const high = withWeight('0.24').rank([candidate], busanContext)[0]!;

    // 가중을 4배 차이로 벌려도 총점은 게이트(0.52) 판정을 뒤집을 만큼 움직이지 않는다.
    expect(Math.abs(low.confidence - high.confidence)).toBeLessThan(0.05);
    expect(withWeight('0.06').weights().popularity).toBeGreaterThan(
      withWeight('0.24').weights().popularity,
    );

    // 빈 문자열은 `Number('') === 0` 이라 검사 없이 쓰면 **retrieval 항이 조용히 사라진다**.
    expect(withWeight('').weights().retrieval).toBeCloseTo(DEFAULT_RETRIEVAL_WEIGHT, 10);
    expect(withWeight('  ').weights().retrieval).toBeCloseTo(DEFAULT_RETRIEVAL_WEIGHT, 10);
    expect(withWeight('abc').weights().retrieval).toBeCloseTo(DEFAULT_RETRIEVAL_WEIGHT, 10);
  });
});
