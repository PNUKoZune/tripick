/// <reference types="jest" />

import { buildPlaceEmbeddingText } from '../../../src/planner/retrieval/place-embedding-text';
import type { IngestPlace } from '../../../src/planner/retrieval/ingestion.types';

/**
 * 적재·재임베딩 CLI·카테고리 backfill 이 **같은 텍스트**를 만들어야 한다. 갈리면 해시가 어긋나
 * 두 경로가 서로의 행을 영영 다시 임베딩한다. 규칙을 한 함수로 모은 뒤의 회귀 방지.
 */
describe('buildPlaceEmbeddingText', () => {
  it('카테고리 상세를 본문에 싣는다 — 카페로 재분류된 KTO 행이 더는 "음식점"이라고 말하지 않는다', () => {
    const text = buildPlaceEmbeddingText(place({ category: 'cafe', categoryDetail: '카페' }));

    expect(text).toContain('카페');
    expect(text).not.toContain('음식점');
  });

  it('카페 카테고리는 태그에도 반영된다', () => {
    const text = buildPlaceEmbeddingText(place({ category: 'cafe', categoryDetail: '카페' }));

    expect(text).toMatch(/태그:.*cafe/);
  });

  it('상세가 없으면 category 로 떨어진다', () => {
    const text = buildPlaceEmbeddingText(place({ category: 'attraction' }));

    expect(text.split(' | ')[1]).toBe('attraction');
  });

  it('지역은 라벨이 아니라 정본 코드로 들어간다 (수집 라벨이 달라도 해시가 같다)', () => {
    const byLabel = buildPlaceEmbeddingText(place({ region: '부산광역시' }));
    const byShort = buildPlaceEmbeddingText(place({ region: '부산' }));

    expect(byLabel).toBe(byShort);
  });
});

function place(overrides: Partial<IngestPlace>): IngestPlace {
  return {
    name: '테스트 장소',
    category: 'restaurant',
    address: '부산광역시 해운대구 구남로 1',
    region: '부산광역시',
    coordinates: { lat: 35.1587, lng: 129.1603 },
    source: 'tour',
    ...overrides,
  };
}
