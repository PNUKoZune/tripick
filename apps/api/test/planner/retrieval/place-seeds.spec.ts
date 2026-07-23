/// <reference types="jest" />

import type { TasteTagDto } from '@tripick/types';
import {
  inferPlaceTags,
  parseSigungu,
  regionStem,
  tasteTagsToKeywords,
} from '../../../src/planner/retrieval/place-seeds';

describe('regionStem', () => {
  it('시도 접미사를 제거해 어간을 만든다', () => {
    expect(regionStem('서울특별시')).toBe('서울');
    expect(regionStem('부산광역시')).toBe('부산');
    expect(regionStem('경상북도')).toBe('경상북');
    expect(regionStem('제주특별자치도')).toBe('제주');
  });

  it('시군구 접미사도 제거한다', () => {
    expect(regionStem('경주시')).toBe('경주');
    expect(regionStem('해운대구')).toBe('해운대');
  });

  it('접미사가 없으면 그대로 두고, 다중 토큰은 첫 토큰만 쓴다', () => {
    expect(regionStem('서울')).toBe('서울');
    expect(regionStem('경주')).toBe('경주');
    expect(regionStem('부산 해운대')).toBe('부산');
  });
});

describe('parseSigungu', () => {
  it('시도 토큰을 건너뛰고 시/군/구 토큰을 뽑는다', () => {
    expect(parseSigungu('경상북도 경주시 불국로 385')).toBe('경주시');
    expect(parseSigungu('서울특별시 강남구 언주로 608')).toBe('강남구');
    expect(parseSigungu('경상남도 창원시 성산구 중앙대로')).toBe('창원시');
  });

  it('시군구가 없으면 null', () => {
    expect(parseSigungu('세종특별자치시 한누리대로 2130')).toBeNull();
    expect(parseSigungu('')).toBeNull();
  });
});

describe('inferPlaceTags', () => {
  it('categoryDetail(카카오 카테고리 경로)에서도 태그를 추출한다', () => {
    const tags = inferPlaceTags({
      name: '이름없는집',
      category: 'restaurant',
      address: '경상북도 경주시 어딘가',
      categoryDetail: '음식점 > 카페 > 디저트카페',
    });
    // '카페' 힌트가 categoryDetail 에서 잡혀야 함
    expect(tags).toContain('cafe');
  });

  it("'산' 이 들어간 지명에 mountain 을 붙인다", () => {
    expect(
      inferPlaceTags({ name: '북한산 둘레길', category: 'attraction', address: '서울특별시 강북구' }),
    ).toContain('mountain');
  });

  it("부산·울산 주소나 '산업'·'산책' 같은 단어에는 mountain 을 붙이지 않는다", () => {
    // 주소에 '산' 이 들어간다는 이유로 부산 전역이 산으로 태깅되던 오탐 방지
    expect(
      inferPlaceTags({ name: '해운대 블루라인파크', category: 'attraction', address: '부산광역시 해운대구' }),
    ).not.toContain('mountain');
    expect(
      inferPlaceTags({ name: '울산대공원', category: 'park', address: '울산광역시 남구' }),
    ).not.toContain('mountain');
    expect(
      inferPlaceTags({ name: '산업기술박물관', category: 'attraction', address: '경기도 성남시' }),
    ).not.toContain('mountain');
  });

  it('확장된 취향 어휘를 장소에서도 뽑아낸다', () => {
    expect(
      inferPlaceTags({ name: '스시 오마카세', category: 'restaurant', address: '서울특별시 강남구' }),
    ).toEqual(expect.arrayContaining(['japanese', 'luxury']));
    expect(
      inferPlaceTags({ name: '광장시장 떡볶이', category: 'restaurant', address: '서울특별시 종로구' }),
    ).toEqual(expect.arrayContaining(['bunsik', 'nostalgic']));
    expect(
      inferPlaceTags({ name: '온양온천', category: 'attraction', address: '충청남도 아산시' }),
    ).toContain('hotspring');
    expect(
      inferPlaceTags({ name: '청평호수', category: 'attraction', address: '경기도 가평군' }),
    ).toContain('lake');
    expect(
      inferPlaceTags({ name: '남이섬', category: 'attraction', address: '강원도 춘천시' }),
    ).toContain('island');
    expect(
      inferPlaceTags({ name: 'N서울타워 전망대', category: 'attraction', address: '서울특별시 중구' }),
    ).toContain('nightview');
  });
});

describe('tasteTagsToKeywords', () => {
  const tags: Omit<TasteTagDto, 'confidence'> = {
    food: ['cafe'],
    mood: ['healing'],
    environment: ['nature'],
  };

  it('신뢰도가 낮거나 유효하지 않은 사진 태그는 검색 키워드에서 제외한다', () => {
    expect(tasteTagsToKeywords({ ...tags, confidence: 0.34 })).toEqual([]);
    expect(tasteTagsToKeywords({ ...tags, confidence: Number.NaN })).toEqual([]);
  });

  it('최소 신뢰도 이상의 사진 태그만 검색 키워드로 사용한다', () => {
    expect(tasteTagsToKeywords({ ...tags, confidence: 0.35 })).toEqual([
      'cafe',
      'healing',
      'nature',
    ]);
  });
});
