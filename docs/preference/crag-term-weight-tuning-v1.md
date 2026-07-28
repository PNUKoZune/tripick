# TriPick CRAG 항목 가중치 튜닝 v1

문서 목적: "`retrieval` 항이 사실상 상수라 순위를 못 가른다"는 항목을 **실측으로 닫는다.** 결론은 예상과 반대였다 — 변별력을 만들어 주는 안(정규화)은 전 구간 손해였고, 가중을 **내리는** 쪽이 답이었다. 두 번의 부정 결과와 그 이유를 고정해 같은 시도를 반복하지 않게 한다.

작업 브랜치: `feat/crag-retrieval-rank-score`
작성일: 2026-07-28
관련 문서: [`retrieval-ranking-tuning-v1.md`](./retrieval-ranking-tuning-v1.md) (이 항목의 출처 §5), [`place-retrieval-region-filter-and-eval-v1.md`](./place-retrieval-region-filter-and-eval-v1.md) (평가 하네스), [`naver-popularity-signal-v1.md`](../planner/naver-popularity-signal-v1.md) (popularity 항)

## 1. 배경 / 문제

[`CragEvaluatorService.evaluate`](../../apps/api/src/planner/retrieval/crag-evaluator.service.ts) 는 7개 항의 가중 합으로 후보 confidence 를 만든다. 그중 `retrieval`(pgvector 유사도)이 **명목 최대 가중 0.24** 인데 순위를 못 가른다는 제보가 있었다. 원인 추정은 사상 공식이었다 — `(similarity + 1) / 2` 는 코사인 -1~1 을 가정하는데 실제 유사도는 좁은 밴드에만 몰린다.

튜닝하기 전에 **분포부터 쟀다.** 상수를 움직이려면 지금 값이 어디에 있고 그 신호가 정답을 가르는지 알아야 하고, 그게 없으면 노이즈를 쫓는다([`retrieval-ranking-tuning-v1.md` §1](./retrieval-ranking-tuning-v1.md) 과 같은 이유).

## 2. 계측 — [`measure-retrieval-similarity.ts`](../../apps/api/src/scripts/measure-retrieval-similarity.ts)

```bash
cd apps/api
pnpm ts-node -r tsconfig-paths/register src/scripts/measure-retrieval-similarity.ts
pnpm ts-node -r tsconfig-paths/register src/scripts/measure-retrieval-similarity.ts --start-at=21:00
```

설계에서 중요한 건 **파이프라인 로직을 다시 쓰지 않는다**는 것이다. 실제 `PlaceRetrievalService.retrieve` 를 그대로 호출하고 `searchByEmbedding`·`rank` 의 반환을 가로챈다. 질의 텍스트 구성·취향 벡터 블렌드·지역 pre-filter·인지도 인덱스가 전부 운영과 동일한 상태의 후보 풀을 본다. 계측용으로 질의를 다시 만들면 그 사본이 파이프라인과 드리프트한다.

재는 것 넷:

1. **밴드** — 코사인 유사도의 분위수(전체·케이스별)
2. **AUC** — 정답 후보가 나머지보다 높은 점수를 받을 확률. 0.5 면 그 항은 정답을 전혀 못 가른다
3. **실효 스프레드** — `가중 × (p95 - p5)`. 항이 총점에서 실제로 만드는 차이
4. **penalty 발동률** — 그 항이 상수인지 아닌지. `--start-at` 은 영업시간 가드를 켜려고 있다(골든셋 케이스엔 방문 시각이 없어 그 항이 늘 중립값이다)

임베딩 소스(remote/hash)를 먼저 찍는 것도 계측의 일부다 — 원격 임베딩 서버가 죽어 해시 폴백을 타면 분포 자체가 다른 이야기가 된다.

## 3. 실측 (골든셋 11케이스 · 후보 1,535건 · BGE-m3-ko 1024차 · 카탈로그 10,481행)

### 3.1 밴드 — 제보보다 더 좁다

| | min | p5 | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- |
| 코사인 | 0.353 | 0.433 | 0.512 | 0.589 | 0.665 |
| `(sim+1)/2` 사상 | | 0.716 | 0.756 | 0.794 | |

실효 스프레드 **0.019**. 제보의 0.73~0.82 보다 좁다.

### 3.2 항목별 변별력 — 랭킹은 popularity 가 혼자 한다

| term | 가중 | AUC | p5 | p50 | p95 | 실효 스프레드 |
| --- | --- | --- | --- | --- | --- | --- |
| **total** | — | **0.887** | 0.600 | 0.667 | 0.759 | — |
| popularity | 0.12 | **0.838** | 0.150 | 0.150 | 1.000 | **0.102** |
| taste | 0.20 | 0.657 | 0.533 | 0.640 | 0.760 | 0.045 |
| retrieval | 0.24 | 0.656 | 0.716 | 0.756 | 0.795 | **0.019** |
| personalization | (taste 내부) | 0.578 | 0.652 | 0.694 | 0.740 | — |
| locality | 0.16 | 0.500 | 0.620 | 0.920 | 0.920 | 0.048 |
| context | 0.13 | 0.500 | 0.633 | 0.633 | 0.802 | 0.022 |
| dataQuality | 0.06 | 0.500 | 1.000 | 1.000 | 1.000 | 0.000 |
| availability | 0.09 | 0.483 | 0.580 | 0.580 | 0.580 | 0.000 |

- `retrieval` 은 **신호 품질이 taste 와 동급(0.656 vs 0.657)인데 발언권이 절반, popularity 의 1/5** 다.
- 케이스 편차가 크다 — jeju 0.78 · busan 0.73 vs **gyeongju-cultural 0.48 · yeosu 0.48 · seoul 0.51**. 11케이스 중 3개는 유사도 순서가 정답과 무관하거나 반대다.
- 하위 네 항(locality·context·dataQuality·availability, 가중 합 0.44)의 AUC 는 전부 0.5 안팎이다.

### 3.3 penalty 발동률 — 어느 항이 상수인가

11케이스 1,441후보(채점 풀) 기준:

| penalty | 항 | 발동 | 총점 영향폭 |
| --- | --- | --- | --- |
| `destination-mismatch` | locality | **0건** | 0.119 |
| `missing-address` | dataQuality | **0건** | 0.015 |
| `closed-at-target-time` | availability | 25건(1.7%, 10시) / 21건(1.5%, 21시) | **0.037** |
| `naver-unmentioned` | popularity | 1,117건(77.5%) | 0.052 |

## 4. 부정 결과 ① — 유사도를 펴서 변별력을 만드는 안 (폐기)

### 4.1 무엇을 만들었나

풀 내 분위수(p5~p95)로 좁은 밴드를 `[0.45, 0.95]` 에 펴는 정규화. 그런데 풀 내 정규화는 **질의마다 기준이 달라져** 절대 confidence 를 못 만들고, confidence 는 accept 게이트(`CRAG_MIN_CONFIDENCE` 0.52)·폴백 판정(`CRAG_TARGET_CONFIDENCE`)·화면 문구가 쓰는 절대값이다.

그래서 **정렬 전용 점수(`crag.rankScore`)를 confidence 와 갈라** 거기에만 정규화를 얹었다 — 정렬은 원래 풀 상대적이라 질의 의존이 무해하다. 인지도 감점이 정렬엔 반영되고 게이트에선 되돌려지는 [기존 구조](../../apps/api/src/planner/retrieval/place-retrieval.service.ts)와 같은 패턴이다.

### 4.2 결과 — 모든 가중치에서 손해

| 모드 | w=0.06 | w=0.10 | w=0.14 | w=0.24 |
| --- | --- | --- | --- | --- |
| 정규화 없음 (`R\|cat`) | 0.585 | 0.585 | 0.585 | 0.585 |
| 정규화 (`R\|cat`) | 0.575 | 0.556 | 0.524 | **0.447** |

`recall@10` 도 같은 방향(0.381 → 0.281), MRR 0.791 → 0.782. **단조롭게** 나빠진다.

### 4.3 왜 실패했나

방식의 문제가 아니라 **신호 품질의 서열** 문제다. §3.2 의 AUC 가 popularity 0.838 > retrieval 0.656 이므로, 벡터 순서에 발언권을 주는 만큼 더 좋은 신호가 밀린다. 진폭을 줄이는 것(밴드를 좁히는 것)은 가중을 낮추는 것과 같은 방향이라 따로 시도할 여지도 없다.

덧붙여 후보 선발 자체가 `ORDER BY embedding <=> query` 다 — 풀 안에서 유사도를 다시 강하게 보는 건 **같은 신호를 두 번 쓰는 것**이다.

### 4.4 밴드가 질의마다 이동한다 — 고정 곡선은 애초에 불가

| 케이스 | p5~p95 | AUC |
| --- | --- | --- |
| gyeongju-weather-indoor | 0.541~0.608 | 0.73 |
| seoul-city-nightview | 0.421~0.516 | 0.51 |

두 밴드가 **겹치지 않는다.** 전역 고정 곡선을 씌우면 경주 후보는 전부 고득점·서울 후보는 전부 저득점이 되는데, 이 오프셋은 품질 차이가 아니라 질의 텍스트에 따른 밴드 이동이다. 케이스를 섞어 잰 AUC(0.584)가 케이스별 평균(0.616)보다 **낮은** 것이 그 오프셋이 노이즈라는 증거다.

## 5. 채택 — retrieval 가중 0.24 → 0.06

정규화 대조군 스윕에서 이득이 나왔다. `CRAG_RANK_NORMALIZE=false` 로 고정하고 가중만 움직인 결과:

| `CRAG_RETRIEVAL_WEIGHT` | recall@5 | recall@10 | `R\|cat` | MRR |
| --- | --- | --- | --- | --- |
| 0 | 0.222 | 0.390 | 0.566 | 0.795 |
| 0.03 | 0.231 | 0.390 | 0.575 | 0.795 |
| **0.06** | **0.231** | **0.390** | **0.585** | **0.841** |
| 0.10 | 0.222 | 0.381 | 0.585 | 0.841 |
| 0.24 (기존) | 0.226 | 0.371 | 0.585 | 0.788 |

0 까지 내리면 `R|cat` 0.566 · MRR 0.795 로 되돌아가므로 항 자체는 필요하다 — **무릎이 0.06**이다.

케이스별로 나빠지는 곳이 없다:

```
                        w=0.06        w=0.24     (R|cat/MRR)
gangneung-cafe-beach   0.60/1.00     0.60/0.50
sokcho-mountain        0.75/1.00     0.75/1.00
seoul-city-nightview   0.33/0.25     0.33/0.17
나머지 8케이스          동일          동일
```

`R|cat` 은 0.585 로 **동일** — 검색 결과 집합은 그대로고 순서만 좋아진다. 스프레드 0.019 짜리 항에서 예상되는 정확히 그 크기의 효과다. 이득의 정체는 "retrieval 이 잘 보게 된 것"이 아니라 **일 안 하는 항이 쥐고 있던 0.18 을 일하는 항들에게 넘긴 것**이다.

### 5.1 남은 몫은 비례 배분 — 합 1 을 지켜야 한다

[`termWeights()`](../../apps/api/src/planner/retrieval/retrieval-rank.ts) 가 retrieval 가중을 받고 나머지 항에 남은 몫을 비례 배분한다. **합이 1 을 벗어나면 안 된다** — 안 그러면 모든 후보의 confidence 가 통째로 내려가 accept 게이트(0.52)가 갑자기 대량 탈락시키고 화면 confidence % 도 같이 낮아진다. 즉 이 배분 덕분에 `CRAG_RETRIEVAL_WEIGHT` 가 **게이트를 흔들지 않는 순수한 랭킹 노브**가 된다.

같은 이유로 accept 게이트의 인지도 감점 되돌림도 상수(`POPULARITY_WEIGHT`)가 아니라 **실효 가중치**(`weights().popularity`)를 봐야 한다. 상수를 쓰면 retrieval 가중을 바꿀 때마다 되돌림 폭이 어긋나 과·소보정이 된다.

## 6. 부정 결과 ② — 죽은 가중을 일하는 항으로 옮기는 안 (폐기)

§3.3 에서 locality·dataQuality 발동률이 0% 이므로, 그 가중을 taste·popularity 로 몰아주는 배율 노브(`CRAG_GUARD_WEIGHT_SCALE`)를 만들어 스윕했다. 결과:

| 가드 배율 | 실효 popularity | recall@5 | recall@10 | `R\|cat` | MRR | conf |
| --- | --- | --- | --- | --- | --- | --- |
| 1.24 (비례 배분) | 0.160 | 0.231 | 0.381 | 0.585 | 0.841 | 0.736 |
| 1.0 | 0.187 | 0.231 | 0.390 | 0.585 | 0.841 | 0.735 |
| 0.75 | 0.217 | 0.231 | 0.399 | 0.585 | 0.841 | 0.734 |
| 0.5 | 0.246 | 0.231 | 0.381 | 0.585 | 0.841 | 0.734 |
| 0.25 | 0.275 | 0.231 | 0.390 | 0.575 | 0.841 | 0.733 |
| 0 (가드 제거) | 0.304 | 0.231 | 0.381 | 0.575 | 0.841 | 0.732 |

popularity 실효 가중이 두 배 가까이 올랐는데 **recall@5 0.231 · MRR 0.841 이 소수점까지 고정**이고, 가드를 없앤 구간에서만 `R|cat` 이 0.585→0.575 로 내려간다(정답 1건 손실). recall@10 의 흔들림(0.381~0.399)은 단조롭지 않아 노이즈다.

**이유는 기계적이다 — 후보 간에 값이 같은 항은 어떤 가중을 줘도 순위를 바꾸지 못한다.** 모든 후보의 총점을 같은 양만큼 올릴 뿐이다. 죽은 가중은 다른 항을 **희석**하는 게 아니라 단순 **offset** 이라서, 옮겨도 나올 게 없다. §5 의 retrieval 가중이 먹혔던 건 그 항이 상수가 아니라 **거의** 상수(스프레드 0.078)였기 때문이고, 그 "거의"가 순위를 흔들고 있었던 것이다.

남는 효과는 confidence 절대 수준(0.736→0.732)뿐이고 그건 accept 게이트를 흔드는 리스크지 이득이 아니다. 그래서 노브는 폐기하고 단순 비례 배분으로 되돌렸다.

## 7. 검증

### 7.1 골든셋 (11케이스, 최종)

```
case                         n    R@5   R@10  R|cat   cat   MRR  region  forb  conf
gyeongju-cultural           16   0.50   0.70   0.90  100%  1.00    100%     0  0.77
busan-beach                 16   0.40   0.50   0.67   90%  1.00    100%     0  0.77
jeju-nature                 16   0.20   0.20   0.50   40%  1.00    100%     0  0.78
seoul-city-nightview        16   0.10   0.20   0.33   60%  0.25    100%     0  0.75
gangneung-cafe-beach        16   0.20   0.50   0.60  100%  1.00    100%     0  0.71
jeonju-food-hanok           16   0.20   0.40   0.83   60%  1.00    100%     0  0.72
yeosu-romantic-island       16   0.40   0.50   0.75   80%  1.00    100%     0  0.68
daegu-nostalgic             16   0.10   0.10   0.10  100%  1.00    100%     0  0.64
gyeongju-weather-indoor     16   0.14   0.29   0.33   86%  0.50    100%     0  0.82
gwangju-culture             16   0.20   0.40   0.67   90%  0.50    100%     0  0.72
sokcho-mountain             16   0.10   0.40   0.75   80%  1.00    100%     0  0.71
----
평균 recall@5 0.231 | recall@10 0.381 | R|cat 0.585 | 커버리지 81% | MRR 0.841 | 지역정합 100% | 금지어 0 | conf 0.733
```

| 지표 | 기존(w=0.24) | 최종(w=0.06) | |
| --- | --- | --- | --- |
| recall@5 | 0.226 | **0.231** | |
| recall@10 | 0.371 | **0.381~0.390** | 실행 간 흔들림 있음(§7.2) |
| `R\|cat` | 0.585 | 0.585 | 결과 집합 불변 — 순서만 개선 |
| MRR | 0.788 | **0.841** | 2케이스 순위 상승 |
| 지역정합 · 금지어 | 100% · 0 | 100% · 0 | |
| 평균 confidence | 0.736 | 0.733 | 게이트 판정 실질 불변 |

### 7.2 재현성 — recall@10 은 실행 간 1건 흔들린다

같은 설정에서 recall@10 이 0.381~0.390 으로 갈렸다. 네이버 코퍼스를 라이브로 받아 6h TTL 캐시 안에서 내용이 바뀌기 때문이다. **케이스 1건 차이(0.009)는 유의미하게 읽으면 안 된다.** `R|cat`·MRR 은 두 실행에서 동일했고, 한 세션 안의 스윕 비교는 유효하다([`retrieval-ranking-tuning-v1.md` §4.2](./retrieval-ranking-tuning-v1.md) 와 동일한 성질).

### 7.3 테스트

- [`retrieval-rank.spec.ts`](../../apps/api/test/planner/retrieval/retrieval-rank.spec.ts) +4 — 기본값이 스윕 무릎값, **모든 가중치에서 합 1**, 비례 배분이라 나머지 항 비율 보존, 범위 밖 값 클램프.
- [`crag-evaluator.service.spec.ts`](../../apps/api/test/planner/retrieval/crag-evaluator.service.spec.ts) +1 — 가중을 4배 벌려도 confidence 가 게이트 판정을 뒤집지 않음 + **빈 문자열 env 방어**(`Number('') === 0` 이라 검사 없이 쓰면 retrieval 항이 조용히 사라진다).
- API 전체 스위트 **572건 통과**, `tsc --noEmit` 통과, eslint 에러 0.

## 8. 알려진 한계

- **`personalization` 은 이번에 손대지 않았다.** 같은 압축 문제가 있지만(밴드 0.303~0.479) AUC 0.578 로 신호가 거의 없다. 골든셋 정답이 '그 목적지의 유명 명소' 라 개인화 품질을 못 재는 [알려진 한계](./retrieval-ranking-tuning-v1.md) 때문일 수 있어, **하네스로 검증할 수 없는 항을 같은 커밋에서 건드리면 회귀 원인을 못 가린다**는 이유로 분리했다.
- **골든셋 11케이스는 회귀 감지용**이다. 여기서 잡은 0.06 은 "0.24 보다 확실히 낫다" 까지만 말하고, 0.03~0.10 사이의 미세 차이를 주장하지 않는다.
- **`locality` 가드는 이 세트로 검증 불가.** 11케이스 전부 pgvector 단독이라 지역 밖 후보가 들어오는 **카카오 폴백 경로를 한 번도 지나지 않는다**. 골든셋은 이 항을 깎아도 "무해"라고 보고하는데 손해는 측정 범위 밖에서 난다.

## 9. 후속 과제 (미포함)

- **`availability` 항 제거 검토** — 영업시간 밖 후보를 실제로 막는 건 이 항(총점 차이 0.037)이 아니라 [`ConstraintEngine.checkOpeningHours`](../../apps/api/src/planner/constraint/constraint.engine.ts) 의 하드 검증이다. 점수 항으로선 중복이고, 실질 이득은 **영업시간 커버리지 544/10,481(5.2%)** 확대에 있다.
- **`dataQuality` 항 제거 검토** — 전 후보 1.000 인 순수 상수. 주소 없는 행이 문제라면 0.05 감점이 아니라 적격성 필터가 맞는 자리다.
- **골든셋에 폴백 케이스 추가** — 적재가 얇은 목적지 + `currentLocation` 으로 카카오 폴백을 타는 케이스, 그리고 방문 시각(`startAt`)이 있는 케이스. 이게 있어야 `locality`·`availability` 변경이 반증 가능해진다(§8 세 번째).
- **임베딩 모델 교체 시 재측정** — §4 의 결론은 "이 모델의 밴드와 AUC 서열" 위에 서 있다. 모델을 바꾸면 [`measure-retrieval-similarity.ts`](../../apps/api/src/scripts/measure-retrieval-similarity.ts) 로 밴드·AUC 를 먼저 다시 재고, retrieval AUC 가 popularity 를 넘는지 확인한 뒤에 정규화를 재고할 것.
