# 개인화·그룹 추천 counterfactual 평가 v1

## 배경

기존 `eval:retrieval`은 “경주 검색에서 불국사가 나왔는가”처럼 목적지 검색의 절대 품질을 본다.
하지만 같은 경주 결과를 모든 사용자에게 돌려줘도 높은 점수를 받을 수 있어, 취향 임베딩이 실제로
무슨 일을 하는지는 증명하지 못했다.

개인화 품질은 다음 질문을 분리해 답해야 한다.

1. 취향을 넣었을 때 무개인화 결과보다 본인 관련 장소가 위로 오는가?
2. 단순 태그 문자열을 넘어서 취향 벡터가 추가 이득을 만드는가?
3. 프로필을 다른 사람 것으로 바꾸면 본인 기준 점수가 내려가는가?
4. 두 사람을 합친 결과가 평균만 높고 한 사람을 완전히 버리지는 않는가?

## 실행

API와 같은 PostgreSQL/place catalog 및 선택적으로 Kakao·Naver·embedding endpoint가 필요하다.

```bash
cd apps/api
pnpm eval:personalization
pnpm eval:personalization -- --case=seoul-heritage-vs-city --k=10
pnpm eval:personalization -- --json=personalization-eval.json
pnpm eval:personalization -- --assert
```

기본 골든셋은 서울·부산·제주·경주·강릉의 5개 목적지와 상반된 10개 페르소나다. `--set`으로
별도 JSON을 넘길 수 있고, `--assert`를 붙인 경우 골든셋의 `expectations`를 회귀 게이트로 쓴다.
일상적인 로컬 탐색은 결과를 먼저 관찰할 수 있도록 기본 실행 자체는 임계값 때문에 실패하지 않는다.

## 실험 설계

각 목적지에서 `generic`을 먼저 실행해 외부 검색 코퍼스 캐시를 고정한 후 다음 결과를 비교한다.

| 모드 | 취향 태그 | 취향 벡터 | 채점 정답 |
|---|---:|---:|---|
| generic | 없음 | 없음 | 본인 |
| tags-only | 본인 | 없음 | 본인 |
| personalized | 본인 | 본인 | 본인 |
| counterfactual | 상대방 | 상대방 | **본인** |
| group-proxy | 두 사람 합집합 | 정규화 평균 | 구성원별 각각 |

`counterfactual`은 단순히 결과 두 개가 달라졌는지를 보지 않는다. A의 정답표를 유지한 채 B의 결과를
채점한다. 따라서 모델이 무작위로 목록만 흔들어도 좋아 보이는 “개인화 착시”를 막는다.

`group-proxy`는 현재 단일 벡터 검색으로 만들 수 있는 centroid 기준선이다. 후속 그룹 공정성 랭커는
이 기준선보다 평균 NDCG뿐 아니라 least-member NDCG와 구성원 coverage를 개선해야 한다.

## 지표

- `NDCG@k`: 관련 장소를 상단에 둘수록 높은 순위 품질
- `recall@k`, `MRR`: 관련 장소 커버리지와 첫 관련 결과 순위
- `lift vs generic`: 개인화 NDCG − 무개인화 NDCG
- `vector lift vs tags`: 벡터 포함 NDCG − 태그만 사용한 NDCG
- `counterfactual lift/win rate`: 본인 프로필 결과가 교체 프로필 결과를 이긴 정도와 비율
- `profile top-k Jaccard`: 두 페르소나 결과 집합의 동일도. 낮다고 곧 품질이 좋은 것은 아니므로
  NDCG/counterfactual 지표와 함께만 해석한다.
- `group average/least NDCG`: 그룹 평균과 가장 불리한 구성원의 품질
- `member coverage@k`: 상위 k 안에 관련 장소가 하나 이상 있는 구성원 비율
- `group disparity`: 최고 구성원과 최저 구성원의 NDCG 차이

지표 함수는 DB와 분리된 `personalization-eval.metrics.ts`에 있고, 중복 정답 카운트·짧은 장소명 부분
일치·주차장 같은 부속 시설 오탐·빈 입력 경계값을 단위 테스트한다.

## 결과 해석 시 주의

- Naver 검색 코퍼스는 시간에 따라 바뀐다. A/B는 반드시 한 프로세스 실행의 모드 간 값으로 본다.
- 출력의 `embeddingSources`가 `hash`이면 의미 임베딩 서버가 아니라 결정적 로컬 폴백을 평가한 것이다.
  모델 성능 결론에는 `remote` 실행 결과를 사용한다.
- 카탈로그에 골든 장소가 적재되지 않았다면 개인화 랭킹이 올릴 후보 자체가 없다. 절대 검색 품질과
  적재 커버리지는 기존 `eval:retrieval`로 함께 확인한다.
- Jaccard 하락만 목표로 튜닝하지 않는다. 다양하게 틀린 목록도 서로 다르기 때문이다.

## 골든셋 변경 규칙

정답은 특정 상호의 광고성 평가가 아니라 각 페르소나에 명백히 부합하는 방문 가능한 고유 장소로
적는다. 음식명·동네명 자체, 주차장·매표소 같은 부속 시설은 제외한다. 모델 변경과 같은 PR에서
정답을 유리하게 고치지 말고, 골든셋 수정은 근거와 함께 별도 리뷰한다.
