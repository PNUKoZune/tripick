/**
 * CRAG 총점의 항목별 가중치.
 *
 * ## retrieval 가중이 0.24 → 0.06 인 이유
 *
 * `retrieval` 항(`(similarity + 1) / 2`)은 코사인 -1~1 을 가정하는데, 실측(골든셋 11케이스
 * 후보 1,535건)에서 코사인은 **p5 0.433 ~ p95 0.589** 에만 몰린다. 사상하면 0.716~0.794 이고
 * 가중 0.24 를 곱해도 총점 스프레드가 **0.019** — 명목 최대 가중인 항이 순위를 거의 못 가른다.
 * 같은 잣대로 popularity 는 가중 0.12 로 스프레드 0.102 를 만든다(5배).
 *
 * 즉 0.24 는 "유사도를 중시한다"가 아니라 **일하는 항들의 비율을 희석**하고만 있었다. 0.06 으로
 * 내리면(남은 몫은 비례 배분) 결과 집합은 그대로고(R|cat 0.585 불변) 순위가 좋아진다
 * — recall@10 0.371→0.390, MRR 0.788→0.841, 나빠지는 케이스 없음. 0 까지 내리면
 * R|cat 0.566·MRR 0.795 로 되돌아가므로 항 자체는 필요하다(무릎이 0.06).
 *
 * ## ⚠️ 유사도를 "펴서" 변별력을 만드는 건 이미 시도했고 실패했다
 *
 * 좁은 밴드를 풀 내 분위수(p5~p95)로 [0.45, 0.95] 에 펴고, 질의 의존성을 피하려 정렬 전용
 * 점수(rankScore)를 confidence 와 갈라 거기에만 얹는 구조까지 만들어 측정했다. 결과는
 * **모든 가중치에서 손해**였다:
 *
 * | 모드 | w=0.06 | w=0.10 | w=0.14 | w=0.24 |
 * |---|---|---|---|---|
 * | 정규화 없음 (R\|cat) | 0.585 | 0.585 | 0.585 | 0.585 |
 * | 정규화 (R\|cat) | 0.575 | 0.556 | 0.524 | **0.447** |
 *
 * 원인은 정규화 방식이 아니라 **신호 품질의 서열**이다. 항목별 AUC(정답이 나머지보다 높은 점수를
 * 받을 확률)를 재면 popularity 0.838 > retrieval 0.656 ≈ taste 0.657 이고, retrieval 은
 * 케이스 편차도 크다(11케이스 중 경주-문화 0.48·여수 0.48·서울 0.51 은 정답과 무관하거나 반대).
 * 벡터 순서에 발언권을 주는 만큼 더 좋은 신호가 밀리므로, 어떤 진폭에서도 이득이 없다.
 *
 * 게다가 후보 선발 자체가 `ORDER BY embedding <=> query` 다 — 풀 안에서 유사도를 다시 강하게
 * 보는 건 같은 신호를 두 번 쓰는 것이다.
 *
 * 재시도할 가치가 생기는 조건은 임베딩 모델 교체나 카탈로그 성격 변화다. 그때는
 * [measure-retrieval-similarity.ts](../../scripts/measure-retrieval-similarity.ts) 로 밴드와
 * 항목별 AUC 를 먼저 다시 재고, retrieval AUC 가 popularity 를 넘는지 확인한 뒤에 손댈 것.
 */

export interface TermWeights {
  retrieval: number;
  taste: number;
  popularity: number;
  locality: number;
  context: number;
  availability: number;
  dataQuality: number;
}

export type RestTerm = Exclude<keyof TermWeights, 'retrieval'>;

/**
 * retrieval 을 뺀 항들의 **상대 비율**(절대 가중치가 아니다). 합이 `1 - retrieval` 이 되도록
 * 비례 배분되므로, 이 표는 "나머지 항끼리의 서열"만 정한다.
 *
 * ## ⚠️ "일 안 하는 항의 가중을 일하는 항으로 옮기기"도 시도했고 효과가 없었다
 *
 * penalty 발동률을 재면 항이 세 갈래로 갈린다 — locality **0%**, dataQuality **0%**,
 * availability 1.6%(방문 시각 주입 시), popularity 77.5% (11케이스 1,441후보).
 * 그래서 발동 0% 인 항의 가중을 taste·popularity 로 몰아주는 배율 노브를 만들어 스윕했는데
 * 전 구간에서 **R@5 0.231 · MRR 0.841 이 소수점까지 동일**했고, 가드를 0 으로 없앤 구간에서만
 * R\|cat 이 0.585→0.575 로 내려갔다.
 *
 * 이유는 기계적이다 — **후보 간에 값이 같은 항은 어떤 가중을 줘도 순위를 바꾸지 못한다.**
 * 모든 후보의 총점을 같은 양만큼 올릴 뿐이다. 즉 가드 항의 가중은 (그 항이 발동하지 않는 한)
 * 랭킹에 아무 영향이 없고, 재분배로 얻을 것도 없다. retrieval 0.24→0.06 이 먹혔던 건 그 항이
 * 상수가 아니라 **거의** 상수였기 때문이다(스프레드 0.078).
 *
 * 남는 효과는 confidence 의 절대 수준(0.736→0.732)뿐이고 그건 accept 게이트를 흔드는 방향의
 * 리스크지 이득이 아니다. 그래서 갈래별 배율 노브는 폐기하고 단순 비례 배분으로 되돌렸다.
 *
 * 이 항들을 정말 개선하려면 가중치가 아니라 다음을 손대야 한다:
 *   - availability: 영업시간 커버리지가 544/10,481(5.2%)이라 대부분 중립값이다. 그리고 영업시간
 *     밖 후보를 실제로 막는 건 이 항(총점 0.037 차이)이 아니라
 *     [ConstraintEngine.checkOpeningHours](../constraint/constraint.engine.ts) 의 하드 검증이다.
 *   - dataQuality: 전 후보 1.000 인 순수 상수. 주소 없는 행이 문제면 적격성 필터가 맞다.
 *   - locality: 지역 밖 후보는 **카카오 폴백 경로에서만** 들어오는데 골든셋 11케이스는 전부
 *     pgvector 단독이다. 즉 이 항은 골든셋으로 검증 불가 — 폴백 케이스를 넣기 전에는 만지지 않는다.
 */
const REST_RATIOS: Record<RestTerm, number> = {
  taste: 0.2,
  popularity: 0.12,
  locality: 0.16,
  context: 0.13,
  availability: 0.09,
  dataQuality: 0.06,
};

/** 스윕 결과 무릎값. `CRAG_RETRIEVAL_WEIGHT` 로 덮을 수 있다. */
export const DEFAULT_RETRIEVAL_WEIGHT = 0.06;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * retrieval 가중을 바꾸고 **남은 몫을 나머지 항에 비례 배분**한다.
 *
 * 합을 1 로 지켜야 하는 게 핵심 — 안 그러면 모든 후보의 confidence 가 통째로 내려가
 * accept 게이트(`CRAG_MIN_CONFIDENCE` 0.52)가 갑자기 대량 탈락시키고 화면의 confidence % 도
 * 같이 낮아진다. 즉 이 함수 덕분에 `CRAG_RETRIEVAL_WEIGHT` 는 **순수한 랭킹 노브**로 스윕할 수
 * 있다(게이트를 흔들지 않는다).
 *
 * 비례 배분이라 나머지 항끼리의 상대 비율은 보존된다.
 */
export function termWeights(retrievalWeight = DEFAULT_RETRIEVAL_WEIGHT): TermWeights {
  const retrieval = clamp01(retrievalWeight);
  const ratioSum = Object.values(REST_RATIOS).reduce((sum, ratio) => sum + ratio, 0);
  const scale = (1 - retrieval) / ratioSum;
  return {
    retrieval,
    taste: REST_RATIOS.taste * scale,
    popularity: REST_RATIOS.popularity * scale,
    locality: REST_RATIOS.locality * scale,
    context: REST_RATIOS.context * scale,
    availability: REST_RATIOS.availability * scale,
    dataQuality: REST_RATIOS.dataQuality * scale,
  };
}

/** 기본 가중치 (테스트 더블·로깅용). */
export const DEFAULT_TERM_WEIGHTS: TermWeights = termWeights();
