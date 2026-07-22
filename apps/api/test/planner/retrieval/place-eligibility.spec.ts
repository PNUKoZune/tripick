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
});
