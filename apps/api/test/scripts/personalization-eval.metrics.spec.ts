import {
  evaluateGroupRanking,
  evaluateRanking,
  placeNameMatches,
  topKJaccard,
} from '../../src/scripts/personalization-eval.metrics';

describe('personalization eval metrics', () => {
  it('computes binary NDCG, unique recall and MRR without double counting a label', () => {
    const metrics = evaluateRanking(
      ['무관한 곳', '동궁과 월지(안압지)', '동궁과월지', '불국사'],
      ['동궁과 월지', '불국사'],
      4,
    );

    const expectedDcg = 1 / Math.log2(3) + 1 / Math.log2(5);
    const idealDcg = 1 + 1 / Math.log2(3);
    expect(metrics.ndcgAtK).toBeCloseTo(expectedDcg / idealDcg);
    expect(metrics.recallAtK).toBe(1);
    expect(metrics.reciprocalRank).toBe(0.5);
    expect(metrics.hits).toEqual(['동궁과 월지', '불국사']);
  });

  it('does not mistake short substrings or ancillary facilities for the destination', () => {
    expect(placeNameMatches('다시', '김광석다시그리기길')).toBe(false);
    expect(placeNameMatches('남부시장 천변유료주차장', '남부시장')).toBe(false);
    expect(placeNameMatches('테라로사 사천해변점', '테라로사')).toBe(true);
  });

  it('measures top-k set separation independent of order and duplicate names', () => {
    expect(topKJaccard(['A', 'B', 'B'], ['B', 'C'], 3)).toBeCloseTo(1 / 3);
    expect(topKJaccard([], [], 10)).toBe(1);
  });

  it('keeps least-member quality and coverage visible in group metrics', () => {
    const metrics = evaluateGroupRanking(
      ['불국사', '첨성대', '황리단길'],
      [
        { id: 'history', relevant: ['불국사', '첨성대'] },
        { id: 'trendy', relevant: ['황리단길'] },
        { id: 'nature', relevant: ['보문호'] },
      ],
      3,
    );

    expect(metrics.averageNdcgAtK).toBeGreaterThan(0);
    expect(metrics.leastNdcgAtK).toBe(0);
    expect(metrics.memberCoverageAtK).toBeCloseTo(2 / 3);
    expect(metrics.ndcgDisparity).toBeGreaterThan(0);
  });

  it('returns finite zero metrics for empty labels and groups', () => {
    expect(evaluateRanking(['A'], [], 10)).toEqual({
      ndcgAtK: 0,
      recallAtK: 0,
      reciprocalRank: 0,
      hits: [],
    });
    expect(evaluateGroupRanking([], [], 10)).toEqual({
      averageNdcgAtK: 0,
      leastNdcgAtK: 0,
      memberCoverageAtK: 0,
      ndcgDisparity: 0,
      members: [],
    });
  });
});
