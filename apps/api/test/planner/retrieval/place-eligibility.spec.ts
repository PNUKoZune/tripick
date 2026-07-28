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
});