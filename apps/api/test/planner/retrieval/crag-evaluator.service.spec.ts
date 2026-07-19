/// <reference types="jest" />

import { CragEvaluatorService } from '../../../src/planner/retrieval/crag-evaluator.service';
import type { RawPlaceCandidate, RetrievalContext } from '../../../src/planner/retrieval/types';

describe('CragEvaluatorService', () => {
  const service = new CragEvaluatorService();

  const busanContext: RetrievalContext = {
    userId: 'user-1',
    destination: '부산',
    trigger: 'waiting',
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

  it('prefers indoor or waiting-friendly places for waiting events', () => {
    const candidates: RawPlaceCandidate[] = [
      {
        id: 'restaurant',
        name: '기장 해산물 식당',
        category: 'restaurant',
        address: '부산 기장군 기장해안로 266',
        coordinates: { lat: 35.1906, lng: 129.2231 },
        source: 'seed',
        tags: ['korean', 'family', 'beach'],
        destinationRegion: 'busan',
      },
      {
        id: 'cafe',
        name: '광안리 브런치 카페',
        category: 'cafe',
        address: '부산 수영구 광안해변로 219',
        coordinates: { lat: 35.1532, lng: 129.1185 },
        source: 'seed',
        tags: ['cafe', 'beach', 'romantic'],
        destinationRegion: 'busan',
      },
    ];

    const ranked = service.rank(candidates, busanContext);

    expect(ranked[0]!.id).toBe('cafe');
    expect(ranked[0]!.confidence).toBeGreaterThan(ranked[1]!.confidence);
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
});
