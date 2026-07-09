/// <reference types="jest" />

import {
  inferPlaceTags,
  parseSigungu,
  regionStem,
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
});
