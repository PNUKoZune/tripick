/// <reference types="jest" />

import {
  SIDO_CODES,
  destinationRegionFilter,
  placeRegionCodes,
  toSidoCode,
  toSigunguCode,
} from '../../../src/planner/retrieval/region-code';

describe('toSidoCode', () => {
  it('표기가 달라도(풀네임·단축·로마자) 같은 코드로 모은다', () => {
    expect(toSidoCode('경상북도')).toBe('경북');
    expect(toSidoCode('경북')).toBe('경북');
    expect(toSidoCode('gyeongbuk')).toBe('경북');
    expect(toSidoCode('서울특별시')).toBe('서울');
    expect(toSidoCode('부산광역시')).toBe('부산');
    expect(toSidoCode('강원특별자치도')).toBe('강원');
    expect(toSidoCode('제주특별자치도')).toBe('제주');
    expect(toSidoCode('세종특별자치시')).toBe('세종');
  });

  it('충청·전라·경상은 남북이 안 섞인다', () => {
    expect(toSidoCode('충청북도')).toBe('충북');
    expect(toSidoCode('충청남도')).toBe('충남');
    expect(toSidoCode('전라북도')).toBe('전북');
    expect(toSidoCode('전북특별자치도')).toBe('전북');
    expect(toSidoCode('전라남도')).toBe('전남');
    expect(toSidoCode('경상남도')).toBe('경남');
  });

  it('시도가 아닌 라벨은 null', () => {
    expect(toSidoCode('경주시')).toBeNull();
    expect(toSidoCode('해운대구')).toBeNull();
    expect(toSidoCode('')).toBeNull();
    expect(toSidoCode(null)).toBeNull();
  });

  it('코드 자신도 같은 코드로 떨어진다(멱등)', () => {
    for (const code of SIDO_CODES) {
      expect(toSidoCode(code)).toBe(code);
    }
  });
});

describe('toSigunguCode', () => {
  it('행정구역 접미사를 뗀다', () => {
    expect(toSigunguCode('경주시')).toBe('경주');
    expect(toSigunguCode('해운대구')).toBe('해운대');
    expect(toSigunguCode('달성군')).toBe('달성');
  });

  it('seed 카탈로그 로마자 슬러그도 한글 코드로 맞춘다', () => {
    expect(toSigunguCode('gyeongju')).toBe('경주');
  });

  it('접미사를 떼면 비는 값·빈 입력은 null', () => {
    expect(toSigunguCode('시')).toBeNull();
    expect(toSigunguCode('')).toBeNull();
    expect(toSigunguCode(null)).toBeNull();
  });
});

describe('destinationRegionFilter', () => {
  it('시도가 잡히면 시도 코드로 좁힌다 (시군구까지 좁히면 인접 후보가 사라진다)', () => {
    expect(destinationRegionFilter('부산 해운대구')).toEqual({ sido: '부산', sigungu: null });
    expect(destinationRegionFilter('경상북도')).toEqual({ sido: '경북', sigungu: null });
    expect(destinationRegionFilter('서울')).toEqual({ sido: '서울', sigungu: null });
  });

  it('시도가 없는 목적지는 시군구 코드로 본다', () => {
    expect(destinationRegionFilter('경주')).toEqual({ sido: null, sigungu: '경주' });
    expect(destinationRegionFilter('경주시')).toEqual({ sido: null, sigungu: '경주' });
    expect(destinationRegionFilter('여수')).toEqual({ sido: null, sigungu: '여수' });
  });

  it('시도 토큰이 뒤에 와도 찾는다', () => {
    expect(destinationRegionFilter('대한민국 제주도')).toEqual({ sido: '제주', sigungu: null });
  });

  it('빈 목적지는 지역 필터 없음(전역 검색)', () => {
    expect(destinationRegionFilter('   ')).toEqual({ sido: null, sigungu: null });
  });
});

describe('placeRegionCodes', () => {
  it('시도 라벨 + 시군구 라벨을 각각 코드로 파생한다', () => {
    expect(placeRegionCodes('경상북도', '경주시')).toEqual({
      regionCode: '경북',
      sigunguCode: '경주',
    });
  });

  it('시군구 라벨이 없으면 시도 코드만', () => {
    expect(placeRegionCodes('부산', null)).toEqual({ regionCode: '부산', sigunguCode: null });
  });

  it('시도로 안 잡히는 시군구 단위 라벨은 시군구 코드로 본다', () => {
    expect(placeRegionCodes('gyeongju', null)).toEqual({ regionCode: null, sigunguCode: '경주' });
  });

  it('폴백 시드(default)는 지역 코드 없이 남아 어느 목적지에서도 후보로 살아 있는다', () => {
    expect(placeRegionCodes('default', null)).toEqual({ regionCode: null, sigunguCode: null });
  });

  it('주소가 수집 라벨을 이긴다 — 코드 표에 없는 통합 행정명이 라벨로 들어와도 소재지를 따른다', () => {
    // KTO 시도 목록이 실제로 돌려주는 통합 라벨. 라벨을 따르면 광주 장소가 전남으로 묶여
    // '광주' 검색에서 사라진다.
    expect(
      placeRegionCodes('전남광주통합특별시', null, '광주 동구 예술길 31'),
    ).toEqual({ regionCode: '광주', sigunguCode: '동' });
    expect(
      placeRegionCodes('전남광주통합특별시', null, '전라남도 여수시 오동도로 222'),
    ).toEqual({ regionCode: '전남', sigunguCode: '여수' });
  });

  it('주소로 못 정하면 라벨로 폴백한다', () => {
    expect(placeRegionCodes('경상북도', '경주시', '')).toEqual({
      regionCode: '경북',
      sigunguCode: '경주',
    });
    expect(placeRegionCodes('부산', null, '해운대해변로 264')).toEqual({
      regionCode: '부산',
      sigunguCode: null,
    });
  });
});
