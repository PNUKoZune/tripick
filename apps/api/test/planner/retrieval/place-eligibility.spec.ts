/// <reference types="jest" />

import { isEligibleItineraryCandidate } from '../../../src/planner/retrieval/place-eligibility';

describe('isEligibleItineraryCandidate', () => {
  it('rejects hospitals and clinics from detailed place categories', () => {
    expect(
      isEligibleItineraryCandidate({
        name: '해운대자생한방병원',
        category: 'attraction',
        categoryDetail: '의료,건강 > 병원 > 한방병원',
      }),
    ).toBe(false);
    expect(
      isEligibleItineraryCandidate({
        name: '광안리한의원',
        category: 'attraction',
        categoryDetail: '의료,건강 > 한의원',
      }),
    ).toBe(false);
  });

  it('rejects legacy medical candidates even when category detail is missing', () => {
    expect(
      isEligibleItineraryCandidate({
        name: '부산365한의원',
        category: 'attraction',
      }),
    ).toBe(false);
  });

  it('keeps explicit travel categories and ordinary attractions', () => {
    expect(
      isEligibleItineraryCandidate({
        name: '옛 제생병원 역사관',
        category: 'attraction',
        categoryDetail: '여행 > 관광,명소 > 문화유적',
      }),
    ).toBe(true);
    expect(
      isEligibleItineraryCandidate({
        name: '국립중앙박물관',
        category: 'attraction',
      }),
    ).toBe(true);
  });

  it('행정구역명 자체는 방문할 장소가 아니다', () => {
    // 카카오에 '제주도' 같은 이름으로 등록된 문서가 있고, 인지도 매칭에서 코퍼스 언급을
    // 통째로 흡수해 상위를 차지한다(실측: 제주 케이스 1위, 인지도 1.00).
    for (const name of ['제주도', '경상북도', '강원도', '부산', '광주광역시']) {
      expect(
        isEligibleItineraryCandidate({
          name,
          category: 'attraction',
          categoryDetail: '여행 > 관광,명소',
        }),
      ).toBe(false);
    }
  });

  it('SEO 상호는 실존 음식점이어도 후보에서 뺀다', () => {
    // '경주맛집' 은 카카오에 등록된 실제 음식점이라 카테고리 화이트리스트를 통과하고,
    // 이름이 코퍼스 상투어와 같아 인지도 1.00 을 받아 상위를 먹었다(경주 케이스 2위).
    for (const name of ['경주맛집', '다솥맛집', '기차여행']) {
      expect(
        isEligibleItineraryCandidate({
          name,
          category: 'restaurant',
          categoryDetail: '음식점 > 한식',
        }),
      ).toBe(false);
    }
  });

  it('코스명은 접미사가 같아도 통과한다', () => {
    for (const name of ['해파랑길 2코스', '강화 자전거 관광코스']) {
      expect(
        isEligibleItineraryCandidate({
          name,
          category: 'attraction',
          categoryDetail: '여행 > 관광,명소',
        }),
      ).toBe(true);
    }
  });

  it('지역명을 품은 실제 장소는 통과한다', () => {
    for (const name of ['강원도립화목원', '제주도립미술관', '부산시민공원']) {
      expect(
        isEligibleItineraryCandidate({
          name,
          category: 'attraction',
          categoryDetail: '여행 > 관광,명소',
        }),
      ).toBe(true);
    }
  });

  describe('좌표 타당성', () => {
    const seoulPark = {
      name: '계남근린공원',
      category: 'attraction',
      categoryDetail: '여행 > 관광,명소 > 공원',
    };

    it('국내 범위 밖 좌표는 후보에서 뺀다 (KTO placeholder 좌표)', () => {
      // 실측: 서울·세종 3행이 전부 `19.694, 117.993`(남중국해)로 적재돼 있었다.
      expect(
        isEligibleItineraryCandidate({
          ...seoulPark,
          coordinates: { lat: 19.69442748, lng: 117.9925662504 },
        }),
      ).toBe(false);
    });

    it('국토 끝단은 통과한다 (마라도·백령도·독도·고성)', () => {
      const edges = [
        { lat: 33.06, lng: 126.27 }, // 마라도
        { lat: 37.96, lng: 124.63 }, // 백령도
        { lat: 37.24, lng: 131.87 }, // 독도
        { lat: 38.61, lng: 128.35 }, // 고성 통일전망대
      ];
      for (const coordinates of edges) {
        expect(isEligibleItineraryCandidate({ ...seoulPark, coordinates })).toBe(true);
      }
    });

    it('(0,0)·NaN 도 막는다', () => {
      expect(isEligibleItineraryCandidate({ ...seoulPark, coordinates: { lat: 0, lng: 0 } })).toBe(false);
      expect(
        isEligibleItineraryCandidate({ ...seoulPark, coordinates: { lat: Number.NaN, lng: 127 } }),
      ).toBe(false);
    });

    it('좌표가 없는 입력은 이 규칙으로 탈락시키지 않는다 (다른 규칙만 적용)', () => {
      expect(isEligibleItineraryCandidate(seoulPark)).toBe(true);
    });
  });
});
