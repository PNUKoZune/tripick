/// <reference types="jest" />

import {
  DEFAULT_RETRIEVAL_WEIGHT,
  DEFAULT_TERM_WEIGHTS,
  termWeights,
} from '../../../src/planner/retrieval/retrieval-rank';

describe('termWeights', () => {
  it('기본값은 스윕 무릎값(0.06)', () => {
    expect(DEFAULT_TERM_WEIGHTS.retrieval).toBeCloseTo(DEFAULT_RETRIEVAL_WEIGHT, 10);
    expect(termWeights()).toEqual(DEFAULT_TERM_WEIGHTS);
  });

  it('retrieval 을 바꿔도 합이 1 이다 — confidence 의 절대 의미가 유지돼야 한다', () => {
    // 합이 1 을 벗어나면 모든 후보의 confidence 가 통째로 움직여 accept 게이트(0.52)와
    // 화면 confidence % 가 함께 흔들린다. 그러면 스윕이 랭킹이 아니라 게이트를 재게 된다.
    for (const weight of [0, 0.03, 0.06, 0.1, 0.24, 0.5, 1]) {
      const sum = Object.values(termWeights(weight)).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it('남은 몫은 비례 배분이라 나머지 항끼리의 비율은 보존된다', () => {
    const low = termWeights(0.06);
    const high = termWeights(0.24);

    expect(low.taste / low.popularity).toBeCloseTo(high.taste / high.popularity, 10);
    // retrieval 이 내려간 만큼 일하는 항들이 올라간다.
    expect(low.popularity).toBeGreaterThan(high.popularity);
    expect(low.taste).toBeGreaterThan(high.taste);
  });

  it('범위를 벗어난 값은 0~1 로 클램프한다', () => {
    expect(termWeights(-1).retrieval).toBe(0);
    expect(termWeights(5).retrieval).toBe(1);
    // 1 이면 나머지 항은 전부 0 (합 1 유지).
    expect(Object.values(termWeights(1)).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});
