/// <reference types="jest" />

import type { TasteTagDto } from '@tripick/types';
import {
  inferPlaceTags,
  parseSigungu,
  regionPrefixStem,
  regionSearchStem,
  regionStem,
  tasteTagsToKeywords,
} from '../../../src/planner/retrieval/place-seeds';

describe('regionStem', () => {
  it('시 계열 접미사는 어간화하되 도는 유지하고, 특별자치도만 도로 정규화한다', () => {
    expect(regionStem('서울특별시')).toBe('서울');
    expect(regionStem('부산광역시')).toBe('부산');
    expect(regionStem('경상북도')).toBe('경상북도');
    expect(regionStem('경기도')).toBe('경기도');
    expect(regionStem('강원특별자치도')).toBe('강원도');
    expect(regionStem('제주특별자치도')).toBe('제주도');
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

describe('regionSearchStem', () => {
  it('모든 토큰을 어간화해 서브지역까지 보존한다', () => {
    expect(regionSearchStem('부산광역시 해운대구')).toBe('부산 해운대');
    expect(regionSearchStem('부산 해운대')).toBe('부산 해운대');
    expect(regionSearchStem('부산 광안리')).toBe('부산 광안리');
    expect(regionSearchStem('제주 서귀포시')).toBe('제주 서귀포');
  });

  it('단일 토큰은 regionStem 과 같게 어간화한다', () => {
    expect(regionSearchStem('경주시')).toBe('경주');
    expect(regionSearchStem('경상북도')).toBe('경상북도');
  });
});

describe('regionPrefixStem', () => {
  it('LIKE 프리픽스용으로 도까지 떼어 짧은 라벨·풀네임을 함께 잡게 한다', () => {
    expect(regionPrefixStem('경기도')).toBe('경기');
    expect(regionPrefixStem('경상북도')).toBe('경상북');
    expect(regionPrefixStem('강원특별자치도')).toBe('강원');
  });

  it('도가 없는 시·군·구·시도는 regionStem 과 동일하다', () => {
    expect(regionPrefixStem('경주시')).toBe('경주');
    expect(regionPrefixStem('부산광역시')).toBe('부산');
    expect(regionPrefixStem('부산')).toBe('부산');
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

  it("'…산' 으로 끝나는 시·군 이름 전체를 산으로 보지 않는다", () => {
    // 예전 규칙은 부산·울산·마산·경산 넉 자만 막아 나머지 열 곳이 새고 있었다(실측 오탐 34건).
    for (const place of [
      { name: 'CGV 논산', category: 'attraction', address: '충남 논산시 시민로 181' },
      { name: '군산 해망굴', category: 'attraction', address: '전북특별자치도 군산시 군산창2길 48' },
      { name: '개심사(서산)', category: 'attraction', address: '충청남도 서산시 운산면 개심사로 321-86' },
      { name: '금산 칠백의총', category: 'attraction', address: '충청남도 금산군 금성면 의총길 50' },
      { name: '스타벅스 동부산DT점', category: 'cafe', address: '부산 기장군 기장해안로 56' },
    ]) {
      expect(inferPlaceTags(place)).not.toContain('mountain');
    }
  });

  it("'…산' 뒤에 시설어가 붙어도 산악 신호를 유지한다", () => {
    // 예전 규칙은 뒤에 한글이 오면 무조건 제외해 가장 대표적인 산악 후보 46건을 놓쳤다.
    for (const name of ['한라산국립공원', '팔공산케이블카', '설악산소공원', '비슬산자연휴양림', '문수산전망대']) {
      expect(
        inferPlaceTags({ name, category: 'attraction', address: '어딘가' }),
      ).toContain('mountain');
    }
  });

  it('앞 글자가 한글이면 행정지명으로 오인하지 않는다 (금오산)', () => {
    // '오'를 오산으로 보고 떨어뜨리면 실제 산이 죽는다.
    expect(
      inferPlaceTags({ name: '금오산', category: 'attraction', address: '경상북도 구미시 남통동' }),
    ).toContain('mountain');
    expect(
      inferPlaceTags({ name: '팔마산', category: 'attraction', address: '전북특별자치도 군산시 동흥남동' }),
    ).toContain('mountain');
  });

  it('임야 지번(산 nnn) 주소는 산·숲 신호로 남긴다', () => {
    // 이름에 '산' 이 없는 백록담·사라오름류가 이 신호로만 잡힌다(실측 200건 중 198건이 산악 후보).
    expect(
      inferPlaceTags({
        name: '백록담',
        category: 'attraction',
        address: '제주특별자치도 서귀포시 토평동 산 15-1',
      }),
    ).toEqual(expect.arrayContaining(['mountain', 'nature']));
  });

  it("제주 오름·휴양림·폭포처럼 '산' 이 없는 자연 후보도 태깅한다", () => {
    expect(
      inferPlaceTags({ name: '용눈이오름', category: 'attraction', address: '제주 제주시 구좌읍' }),
    ).toContain('mountain');
    expect(
      inferPlaceTags({ name: '고대산자연휴양림', category: 'attraction', address: '경기도 연천군' }),
    ).toEqual(expect.arrayContaining(['nature', 'healing']));
    expect(
      inferPlaceTags({ name: '천지연폭포', category: 'attraction', address: '제주 서귀포시' }),
    ).toContain('nature');
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

  /**
   * 산 이외의 자연 지형 접미. 카탈로그 실측(10,721행)으로 오탐률을 재서 고른 것들이라,
   * 접미를 늘릴 때도 같은 방식으로 재고 나서 넣어야 한다.
   */
  it('자연 지형 접미를 산악·자연 신호로 읽는다', () => {
    // 이게 없어서 제주 최대 명소가 cultural 하나로 떨어졌다.
    expect(
      inferPlaceTags({ name: '성산일출봉', category: 'attraction', address: '제주특별자치도 서귀포시 성산읍 일출로 284-12' }),
    ).toEqual(expect.arrayContaining(['mountain', 'nature']));
    expect(
      inferPlaceTags({ name: '추암 촛대바위', category: 'attraction', address: '강원특별자치도 동해시 촛대바위길' }),
    ).toEqual(expect.arrayContaining(['mountain', 'nature']));
  });

  it('동굴은 자연이되 산악은 아니다', () => {
    // '군산 해망굴'은 해안 터널이라 mountain 을 주면 산악 취향 질의에 잘못 걸린다.
    const tags = inferPlaceTags({ name: '군산 해망굴', category: 'attraction', address: '전북특별자치도 군산시 군산창2길 48' });
    expect(tags).toContain('nature');
    expect(tags).not.toContain('mountain');
  });

  it("전망대·등대는 자연 지형이 아니다 ('대' 를 접미로 넣지 않은 이유)", () => {
    // 실측 178건이 거의 전부 전망대·등대·천문대라 '대' 를 넣으면 시설이 통째로 nature 가 된다.
    // (산 이름이 든 '구봉산전망대'는 MOUNTAIN_FACILITY_WORDS 규칙으로 산악이 맞다 — 여기선 제외)
    for (const name of ['송대말등대', '동춘터널전망대']) {
      expect(
        inferPlaceTags({ name, category: 'attraction', address: '강원특별자치도 삼척시' }),
      ).not.toContain('nature');
    }
  });
});