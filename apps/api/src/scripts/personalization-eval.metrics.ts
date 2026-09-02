/**
 * 개인화/그룹 추천 평가의 순수 지표 함수.
 *
 * 실제 검색·DB·외부 API와 분리해 지표 정의 자체를 단위 테스트할 수 있게 둔다. 평가 하네스가
 * 잘못된 수식을 써 개선을 과장하면 모델보다 더 위험하므로, 중복 정답과 0건 같은 경계값도
 * 여기서 한 번만 처리한다.
 */

const MIN_PARTIAL_MATCH_LENGTH = 3;
const ANCILLARY_TOKENS = ['주차장', '매표소', '안내소', '정류장', '화장실'] as const;

export interface RankingMetrics {
  ndcgAtK: number;
  recallAtK: number;
  reciprocalRank: number;
  hits: string[];
}

export interface GroupRankingMetrics {
  averageNdcgAtK: number;
  leastNdcgAtK: number;
  memberCoverageAtK: number;
  ndcgDisparity: number;
  members: Array<{ id: string; metrics: RankingMetrics }>;
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

/**
 * 통용 표기의 공백 차이는 허용하되, 2글자 우연 일치와 부속 시설 오탐은 막는다.
 * 기존 retrieval 골든셋과 동일한 보수적 규칙이다.
 */
export function placeNameMatches(candidate: string, expected: string): boolean {
  const actual = normalizeName(candidate);
  const target = normalizeName(expected);
  if (actual === target) return true;
  if (ANCILLARY_TOKENS.some((token) => actual.includes(token) && !target.includes(token))) {
    return false;
  }
  const shorter = actual.length <= target.length ? actual : target;
  if (shorter.length < MIN_PARTIAL_MATCH_LENGTH) return false;
  return actual.includes(target) || target.includes(actual);
}

function relevantLabelsAtRank(rankedNames: string[], relevant: string[], k: number): string[] {
  const unmatched = [...new Set(relevant.map((name) => name.trim()).filter(Boolean))];
  const hits: string[] = [];

  for (const candidate of rankedNames.slice(0, Math.max(0, k))) {
    const index = unmatched.findIndex((expected) => placeNameMatches(candidate, expected));
    if (index < 0) continue;
    hits.push(unmatched[index]!);
    unmatched.splice(index, 1);
  }
  return hits;
}

/** Binary relevance NDCG@k + 고유 정답 기준 recall@k/MRR. */
export function evaluateRanking(
  rankedNames: string[],
  relevant: string[],
  k: number,
): RankingMetrics {
  const safeK = Math.max(0, Math.floor(k));
  const uniqueRelevant = [...new Set(relevant.map((name) => name.trim()).filter(Boolean))];
  const matched = new Set<string>();
  let dcg = 0;
  let firstRank = 0;

  rankedNames.slice(0, safeK).forEach((candidate, index) => {
    const expected = uniqueRelevant.find(
      (name) => !matched.has(name) && placeNameMatches(candidate, name),
    );
    if (!expected) return;
    matched.add(expected);
    dcg += 1 / Math.log2(index + 2);
    if (firstRank === 0) firstRank = index + 1;
  });

  const idealHits = Math.min(safeK, uniqueRelevant.length);
  let idcg = 0;
  for (let index = 0; index < idealHits; index += 1) idcg += 1 / Math.log2(index + 2);

  return {
    ndcgAtK: idcg === 0 ? 0 : dcg / idcg,
    recallAtK: uniqueRelevant.length === 0 ? 0 : matched.size / uniqueRelevant.length,
    reciprocalRank: firstRank === 0 ? 0 : 1 / firstRank,
    hits: relevantLabelsAtRank(rankedNames, uniqueRelevant, safeK),
  };
}

/** 순서와 무관한 top-k 집합 유사도. 1이면 두 페르소나 결과가 완전히 같다. */
export function topKJaccard(left: string[], right: string[], k: number): number {
  const normalizeSet = (values: string[]) =>
    new Set(values.slice(0, Math.max(0, k)).map(normalizeName).filter(Boolean));
  const a = normalizeSet(left);
  const b = normalizeSet(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  const intersection = [...a].filter((name) => b.has(name)).length;
  return intersection / union.size;
}

/** 그룹 결과를 각 구성원의 정답표로 따로 채점해 평균뿐 아니라 최저 만족도를 보존한다. */
export function evaluateGroupRanking(
  rankedNames: string[],
  members: Array<{ id: string; relevant: string[] }>,
  k: number,
): GroupRankingMetrics {
  const scored = members.map((member) => ({
    id: member.id,
    metrics: evaluateRanking(rankedNames, member.relevant, k),
  }));
  const ndcgs = scored.map((member) => member.metrics.ndcgAtK);
  const average = ndcgs.length === 0 ? 0 : ndcgs.reduce((sum, value) => sum + value, 0) / ndcgs.length;
  const least = ndcgs.length === 0 ? 0 : Math.min(...ndcgs);
  const greatest = ndcgs.length === 0 ? 0 : Math.max(...ndcgs);
  const covered = scored.filter((member) => member.metrics.hits.length > 0).length;

  return {
    averageNdcgAtK: average,
    leastNdcgAtK: least,
    memberCoverageAtK: scored.length === 0 ? 0 : covered / scored.length,
    ndcgDisparity: greatest - least,
    members: scored,
  };
}

