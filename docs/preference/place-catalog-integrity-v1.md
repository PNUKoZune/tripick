# TriPick 장소 카탈로그 정합성 점검 v1

문서 목적: 지역 수집·임베딩 구조 전반 점검에서 드러난 결함 8건의 원인·결정·검증을 고정하고, 영업시간 커버리지의 마지막 우회로(KTO 역조회)를 실측으로 배제한 근거를 남긴다.

작업 브랜치: `fix/region-ingest-integrity`
작성일: 2026-07-30
관련 문서: [`place-embedding-enrichment-v1.md`](./place-embedding-enrichment-v1.md) (적재 파이프라인·append 커서), [`place-retrieval-region-filter-and-eval-v1.md`](./place-retrieval-region-filter-and-eval-v1.md) (지역 코드 pre-filter), [`merged-sido-label-v1.md`](./merged-sido-label-v1.md) (통합 라벨), [`catalog-name-quality-v1.md`](./catalog-name-quality-v1.md) (정리 CLI 설계), [`crag-term-weight-tuning-v1.md`](./crag-term-weight-tuning-v1.md) §10 (영업시간 구조적 천장)

## 1. 배경

기능 추가가 아니라 **점검**에서 시작했다. 대상은 "수집 → 정규화 → dedupe → 임베딩 → 적재 → 검색 pre-filter" 전 구간이고, 코드 대조와 로컬 카탈로그 10,478행 실측을 함께 썼다.

**구조 자체는 문제가 없었다.** 라벨(`destination_region`)과 정본 코드(`region_code`)를 분리해 필터는 등가 비교로 가고, 적재·질의가 같은 함수([`placeRegionCodes`](../../apps/api/src/planner/retrieval/region-code.ts)·`destinationRegionFilter`)를 공유하고, 증분 판정(`text_hash`·`embedding_model`)과 해시 폴백·차원 불일치 차단이 다 자리에 있다. 실측도 깨끗했다 — `region_code` NULL 0행, `embedding` NULL 0행, `embedding_model='hash'` 0행, `kakao_place_id` 중복 0건.

문제는 그 위에 얹힌 8건이고, 성격이 둘로 갈린다.

- **비결정성** — 같은 장소·같은 지역인데 실행 옵션(`--regions`·`--max`)이나 수집 경로에 따라 결과가 달라진다(§3.1·3.2·3.4·3.6).
- **한쪽만 막힌 게이트** — 적재는 막았는데 검색은 안 막았거나, 한 실행 안에서는 막는데 실행 간에는 안 막는다(§3.3·3.7·3.8).

두 부류 모두 증상이 조용하다. 후보가 통째로 사라지거나, 매 실행 재임베딩이 도는데 로그는 "정상"으로 보인다.

## 2. 변경 요약

| # | 결함 | 조치 | 실측 |
| --- | --- | --- | --- |
| 1 | 시군구 단위 타깃이 기본 소스에서 통째로 스킵 | tour 만 건너뛰고 타깃 유지 | `--regions=속초 --sources=tour,kakao` 0건 → 3건 |
| 2 | 빈 시도 코드로 KTO 전국 조회 누수 | `areaCode` 없으면 tour 수집 차단 | (1의 부작용 차단) |
| 3 | reseed 가 `'default'` 라벨을 오삭제 + 시군구 라벨 잔존 | 삭제 키에 정본 코드 추가, slug 폴백값 제외 | 강원 631행 → 711행 |
| 4 | auto-seed 게이트가 실제 카탈로그를 못 봄 | `countRegionCandidates` 로 교체 | 1만 행 있어도 0으로 보던 것 |
| 5 | 폴백 시드가 모든 지역 검색에 남음 | `'default'` 시드 DB 주입 차단 | unlabeled 6행 유입 경로 제거 |
| 6 | 임베딩 텍스트가 수집 라벨을 물어 해시 churn | 지역 신호를 정본 코드로 | 재실행 갱신 0 / 유지 3 |
| 7 | `sigungu_code` 한 글자 코드 | 한 글자만 남는 자치구는 접미사 유지 | 1,554행 정정 |
| 8 | append 커서가 `--max` 에 묶임 | 페이지 → 행 오프셋 | 커서 page 3 → offset 200 |
| 9 | 숙박이 검색 후보로 유입 | 적격성 게이트에 카테고리 차단 | 6행 + 런타임 경로 |
| 10 | 실행 간 소스 중복 | `findSamePlace` 로 신규 행 차단 | 250m 내 동명 쌍 142 → 0 |

(#1·#2 와 #4·#5 는 각각 한 결함의 앞뒤라 본문에서는 8건으로 센다.)

## 3. 상세

### 3.1 시군구 단위 타깃이 기본 소스에서 스킵됐다

`--regions=속초` 처럼 시도로 안 잡히는 지역은 KTO `lDongRegnCd` 를 못 만든다. 코드는 그때 `continue` 로 **타깃 자체를 버렸다** — `sources` 에 tour 가 들어 있으면(기본값 `tour,kakao`) 카카오·popular 수집까지 함께 취소됐다.

주석의 의도는 "tour 소스만 건너뛴다"였고, 실제로 카탈로그의 강릉·속초·여수·전주·경주 라벨 183행은 `--sources=popular` 로 tour 를 빼야만 넣을 수 있었던 흔적이다.

**결정:** tour 를 뺀 나머지 소스가 하나라도 있으면 타깃을 살리고, tour 만 요청됐을 때만 건너뛴다.

⚠️ **타깃을 살리면 새 구멍이 열린다** — `areaCode` 가 빈 문자열로 [`fetchByArea`](../../apps/api/src/planner/retrieval/tour-api.service.ts) 에 들어가고, 빈 `lDongRegnCd` 는 KTO 에서 **지역 필터 없는 전국 조회**가 된다. 그러면 타지역 장소가 '속초' 라벨로 적재된다. 그래서 `ingestRegion` 에서 시도 코드 없는 타깃의 tour 수집을 명시적으로 끊었다(`resolveTargetSidos` 의 KTO 목록 실패 폴백 경로도 이 가드가 함께 덮는다).

### 3.2 reseed 삭제 키가 두 방향으로 틀렸다

[`deleteRegion`](../../apps/api/src/planner/retrieval/place-embedding.repository.ts) 은 라벨 표기가 섞인 걸 흡수하려고 세 조건(원문 / seed 슬러그 / 어간 프리픽스)으로 지웠는데, 둘이 틀렸다.

**(a) `'default'` 오삭제.** `normalizeDestinationRegion` 은 아는 슬러그 넷(seoul·busan·jeju·gyeongju) **밖의 모든 지역을 `'default'` 로** 떨어뜨린다. 그 값이 삭제 조건에 그대로 들어가 있어서 `--reseed --regions=강원특별자치도` 가 `destination_region='default'` 행을 함께 지웠다. 폴백 시드는 지역과 무관한 공용 행이라 다른 지역 검색이 함께 망가진다.

**(b) 시군구 라벨 잔존.** 어간 프리픽스 `'강원%'` 는 시군구 단위로 적재된 `'속초'`·`'강릉'` 라벨을 못 잡는다. 실측 78행이 살아남는데, 이건 **reseed 가 막으려던 바로 그 상황**이다 — 임베딩 모델을 바꿔 재생성할 때 옛 모델 벡터가 새 벡터와 같은 공간에 섞인다.

**결정:** 라벨 조건은 유지하되 `region_code = ANY(codes)` 를 더하고, slug 조건은 `'default'` 일 때 제외한다. 코드는 [`sidoCodesForLabel`](../../apps/api/src/planner/retrieval/region-code.ts) 로 뽑아 통합 라벨(`전남광주통합특별시`)이 포괄하는 두 시도를 모두 지운다. 시도로 안 잡히는 라벨은 코드가 비어 라벨 조건만 적용된다 — `'속초'` reseed 가 강원 전체를 비우지 않는다.

실 DB 트랜잭션 롤백으로 확인한 범위:

| 대상 | 이전 | 이후 |
| --- | --- | --- |
| 강원특별자치도 | 631행 | **711행** (속초·강릉 라벨 78행 포함) |
| 속초 (시군구 타깃) | — | 38행만 |
| 전남광주통합특별시 | 라벨분만 | 814행 (광주 + 전남) |

⚠️ 코드로 지우면 이웃 지역 적재에서 국경을 넘어 들어온 행(라벨 `'경기도'`·`region_code='강원'`)도 함께 지워진다. 그 장소의 소재지가 이 시도이므로 이 시도 재적재의 대상으로 보는 게 맞다고 판단했고, 주석에 명시했다.

### 3.3 auto-seed 게이트가 실제 카탈로그를 못 봤다

`countSeededRegion` 은 `lower(destination_region) = 'seoul'` 처럼 **seed 슬러그 라벨만** 셌다. 적재는 `'서울특별시'` 로 넣으므로 카탈로그가 1만 행이어도 0으로 보고 시드를 주입했다.

더 나쁜 건 슬러그에 없는 목적지다. `normalizeDestinationRegion('강릉')` = `'default'` → `DEFAULT_SEEDS`(서울 도심 좌표의 가짜 6건)가 들어가고, 그 행은 `region_code`·`sigungu_code` 가 둘 다 null 이라 **지역 필터의 unlabeled 예외로 모든 목적지 검색에 후보로 남는다**. 좌표가 서울 고정이라 다른 지역 여행의 동선을 깨뜨린다.

**결정 두 개.**

1. 게이트를 [`countRegionCandidates`](../../apps/api/src/planner/retrieval/place-embedding.repository.ts) 로 교체 — 검색과 **같은 정본 코드**로 센다. 라벨 표기와 무관하고, 지역 라벨 없는 행은 세지 않는다(그 몇 건이 모든 지역을 '적재됨'으로 위장한다).
2. `seedRegion` 이 `'default'` 일 때 DB 주입을 거부. 카탈로그가 빈 목적지는 [`retrieve()`](../../apps/api/src/planner/retrieval/place-retrieval.service.ts) 의 인메모리 seed 폴백이 이미 커버하므로 동작 손실이 없다 — DB 에 쓰레기를 남기지 않는 쪽만 다르다.

로컬은 `PLACE_RETRIEVAL_AUTO_SEED=false` 라 증상이 없었지만 코드 기본값과 `.env.example` 은 `true` 다. 즉 새 환경에서 켜지는 지뢰였다.

### 3.4 임베딩 텍스트가 수집 라벨을 물고 있었다

`buildText` 가 지역 신호로 `place.region`(수집 타깃 라벨) + 시군구 라벨을 넣었다. 같은 장소를 `--regions=속초` 로 수집하면 `지역: 속초 속초시`, `--regions=강원` 으로 수집하면 `지역: 강원특별자치도 속초시` 다. 텍스트가 다르니 `text_hash` 가 다르고, 증분 판정이 **매 실행 재임베딩**으로 떨어지며 라벨도 뒤집힌다.

**결정:** 지역 신호를 `placeRegionCodes` 파생 코드(`강원 속초`)로 바꾼다. 코드는 주소에서 나오므로 어느 타깃으로 수집해도 같다.

**전량 재임베딩(`--reseed`)은 필요 없다.** 구·신 텍스트를 실제 임베딩 서버에 넣어 코사인을 재봤다.

| 쌍 | cos |
| --- | --- |
| 속초시립박물관 (구 텍스트 vs 신 텍스트) | 0.99654 |
| 교동귀금속거리 | 0.99744 |
| 불국사 | 0.99290 |
| 대조군: 속초시립박물관 vs 불국사 | 0.49811 |

같은 지점으로 봐도 되는 거리라, 증분 갱신 도중 구·신 벡터가 섞여 있어도 검색 공간이 어긋나지 않는다. 모델 전환과 달리 재적재를 서두를 이유가 없다.

⚠️ 다만 골든셋 지표(R\|cat·MRR)를 **이전 수치와 비교하려면** 카탈로그가 새 텍스트로 대부분 바뀐 뒤에 재야 한다. 지금 재면 혼재 상태를 재는 셈이라 이번 작업에서는 재지 않았다.

### 3.5 `sigungu_code` 한 글자 코드 1,554행

[`toSigunguCode`](../../apps/api/src/planner/retrieval/region-code.ts) 가 접미사를 무조건 떼서 `'중구'→'중'`, `'동구'→'동'` 을 만들었다. 카탈로그에서 동·중·북·남·서 다섯 글자가 1,554행이다.

한 글자 코드는 두 가지로 쓸모가 없다. (a) 실재하는 지명이 아니라 사람이 읽을 수 없고, (b) `'중'` 이 서울·부산·대구·인천 중구를 한꺼번에 뜻해 **필터로서 아무것도 좁히지 못한다**.

**결정:** 떼서 한 글자만 남으면 접미사를 남긴다. `'해운대구'→'해운대'` 는 그대로, `'중구'→'중구'`. 질의 쪽도 같은 함수를 쓰므로 사용자가 입력한 `'중구'` 와 그대로 만난다. 시도가 함께 오면(`'대구 중구'`) `destinationRegionFilter` 가 시도 코드를 우선하므로 동명 시군구 혼동은 그 단계에서 갈린다.

기존 행은 [`pnpm rederive:region-codes --apply`](../../apps/api/src/scripts/rederive-region-codes.ts) 로 정정했다(1,554행, 한 글자 코드 0행). 이 스크립트가 SQL 로 규칙을 다시 쓰지 않고 `placeRegionCodes` 를 그대로 태우는 구조라, 규칙을 바꿀 때마다 같은 명령으로 카탈로그를 맞출 수 있다.

기존 스펙에 `sigunguCode: '동'` 을 기대하는 케이스가 있었는데 그건 결함을 고정한 기대값이라 `'동구'` 로 갱신했다.

### 3.6 append 커서가 실행 옵션에 묶여 있었다

`ingest_cursors.next_page` 는 페이지 번호였고, KTO 는 `pageNo`·`numOfRows` 만 받는다. `numOfRows` 는 그 실행의 `--max` 에서 나오므로 **page 3 이 `--max=100` 이면 200행부터, `--max=50` 이면 100행부터**를 뜻한다. 커서를 쓴 실행과 읽는 실행의 옵션이 다르면 안 읽은 구간을 영구히 건너뛰거나 같은 구간을 되읽는다.

**결정:** 커서 단위를 행 오프셋(`next_offset`)으로 바꾼다. 오프셋을 페이지 경계로 **내림** 정렬해 `pageNo` 로 환산한다 — 내림이면 최악이 "이미 읽은 구간 재확인"(텍스트 해시 동일 → 유지)이고, 올림이면 그 사이 행이 영구히 빠진다.

마이그레이션 [`1785600000000`](../../apps/api/src/database/migrations/1785600000000-IngestCursorOffset.ts) + init.sql 이 기존 커서를 옛 기본 배치 100 기준으로 환산한다. 정확한 배치 크기를 저장한 적이 없어 근사이지만 내림 방향이라 누락은 없다. 로컬 커서(`경상북도 tour`)가 page 3 → offset 200 으로 환산됐다.

### 3.7 숙박이 검색 후보로 들어왔다

카탈로그에 `category='accommodation'` 6행이 있었다(KTO `contentTypeId=32` 제외 규칙 이전 잔재). 지우면 끝나는 데이터 문제인 줄 알았는데 게이트에 구멍이 있었다.

적재 경로는 셋 다 막혀 있다 — KTO 는 타입 32 제외, 카카오 적재는 `AD5` 를 애초에 검색하지 않고(`KAKAO_CATEGORY_CODES`), popular 은 축 카테고리 화이트리스트. 남은 건 **검색 런타임 카카오 폴백**이다. [`KakaoLocalService.search`](../../apps/api/src/planner/retrieval/kakao-local.service.ts) 는 `category_group_code` 제한 없이 키워드로 훑어서(`'속초 관광지'` → `'OO관광호텔'`) `AD5` 문서를 후보로 올리고, `categoryFromKakao` 가 그걸 `'accommodation'` 으로 매핑한다. [`isEligibleItineraryCandidate`](../../apps/api/src/planner/retrieval/place-eligibility.ts) 에는 숙박 차단이 없어 그대로 통과했다.

증상이 "호텔이 후보에 낀다"로 끝나지 않는다 — `PlannerService.toItemType` 이 `accommodation` 을 `'attraction'` 으로 접으므로 **호텔이 '관광지' 일정 항목**이 된다.

**결정:** 적격성 게이트에 카테고리 차단(`EXCLUDED_CATEGORIES`)을 넣는다. 카테고리 정본만 보고 이름·`categoryDetail` 은 보지 않는다 — 호텔 안의 카페는 `category='cafe'` 라 통과해야 하고, 이름에 '호텔'이 든 식당을 죽이면 안 된다.

### 3.8 실행 간 소스 중복

적재 dedupe(이름+좌표)는 **한 실행 안에서만** 돌고, DB 조회는 ID(`kakao_place_id`/`tourism_api_id`)로만 했다. 그래서 KTO 가 넣은 장소를 다음 실행의 카카오가 다른 ID 로 다시 넣었다.

먼저 규모와 판정 기준을 실측했다. 이름(정규화)이 같은 쌍 376개의 거리 분포:

| 거리 | 쌍 | 소스 교차 |
| --- | --- | --- |
| 0~100m | 114 | 113 |
| 100~200m | 24 | 24 |
| 200~300m | 10 | 10 |
| 300~400m | 11 | 11 |
| 400~500m | 8 | 5 |
| 500m 초과 | 209 | — |

**400m 까지는 전부 소스 교차**(한쪽 KTO·한쪽 카카오)로 같은 장소를 다르게 지오코딩한 것이다(대전오월드 311m·국립중앙과학관 381m 처럼 넓은 시설의 입구 vs 중심). 400m 를 넘으면 교차 비율이 떨어지고 500m 초과 209쌍은 도시마다 있는 동명 장소(`중앙시장` 등)다.

**결정: 반경 250m.** 무릎은 400m 부근이지만 잘못 합치면 실재하는 장소가 사라지는 방향이라, KTO 이름 검색 매칭이 쓰던 값과 같은 250m 를 채택했다(그 상수를 [`SAME_PLACE_RADIUS_M`](../../apps/api/src/planner/retrieval/near-duplicate.ts) 하나로 통일하고 `TourApiService` 사본을 지웠다). 100~400m 잔여는 검색 단계 `collapseNearDuplicates` 가 접어 사용자에게 안 보인다.

**결정: 갱신이 아니라 건너뛰기.** 한 장소의 KTO 표현과 카카오 표현은 카테고리 상세·주소 표기가 달라 텍스트가 다르다. 기존 행에 덮어쓰면 실행마다 두 소스가 같은 행의 텍스트를 번갈아 바꿔 **매번 재임베딩되는 churn** 이 된다. 먼저 들어온 표현을 정본으로 두면 해시가 안정되고 임베딩 호출도 안 쓴다. 단 영업시간은 예외로 비어 있을 때만 채운다 — 임베딩 텍스트 밖이라 재임베딩을 부르지 않고, 카카오가 못 주는 값이라 놓치면 KTO 재조회밖에 없다.

실행 내 dedupe 도 같은 반경 규칙으로 바꿨다. 좌표 버킷(소수 3자리) 비교는 경계에 걸린 쌍을 놓쳐서(250m 내 138쌍 중 68쌍이 버킷 밖) **DB 판정과 규칙이 갈렸다** — 같은 실행에 둘 다 통과한 뒤 두 번째가 첫 행을 덮어쓰는 낭비가 난다.

**인덱스가 필요했다.** `findSamePlace` 는 신규 후보마다 도는 조회인데 인덱스 없이 10,331행에서 11ms(전체 스캔)였고 카탈로그 크기에 선형으로 악화된다. 정규화 이름 함수 인덱스([`1785700000000`](../../apps/api/src/database/migrations/1785700000000-PlaceNameLookupIndex.ts))로 **0.23ms**. 인덱스 식은 질의 식과 문자까지 같아야 계획기가 쓴다.

## 4. 데이터 정리

게이트가 정본이고 정리는 게이트 이전에 들어온 행만 걷는다는 원칙([catalog-name-quality §6](./catalog-name-quality-v1.md))을 그대로 따랐다. `cleanup:catalog` 에 부류 둘을 추가했다.

- `lodging` — `category='accommodation'`
- `dup` — 이름+좌표 무리당 1행만 남긴다. 우선순위는 **영업시간 > 대표 이미지 > 먼저 적재된 행**. 영업시간을 1순위로 둔 이유는 그것만 Constraint Engine 이 실제로 소비하고 카카오 소스는 아예 못 주는 값이라, 잃으면 복구 경로가 KTO 재조회뿐이어서다.

삭제 전 위험 검사(카테고리 엇갈림·동일 소스끼리)에서 8쌍이 걸렸고 전부 같은 장소였다 — KTO `'음식점'` vs 카카오 `'카페'` 분류 차이(6~148m), 오목대 38m(둘 다 카카오).

| 항목 | 결과 |
| --- | --- |
| `cleanup:catalog --only=lodging,dup --apply` | 숙박 6 + 중복 142 = **148행 삭제** (10,479 → 10,331) |
| `rederive:region-codes --apply` | `sigungu_code` **1,554행 정정** |
| 정리 후 | 250m 내 동명 쌍 0 / 숙박 0 / 한 글자 코드 0 |

`text_hash`·`embedding_model` 이 NULL 인 옛 행(2026-07-08 적재) 89행은 별도 조치하지 않았다. 85행이 위 정리에 함께 걸려 **6행만 남았고**, 남은 것도 그 지역을 재적재하면 `findProvenance` 가 `tourism_api_id` 로 찾아 채운다.

## 5. 영업시간 커버리지 — KTO 역조회 배제

카탈로그 영업시간은 544/10,478(5.2%)이고, 카카오·popular 5,846행은 **0**이다. 카카오 Local API 응답에 영업시간 필드가 없어서(`KakaoDocument` 는 전화·주소·좌표만) 구조적이다. 이 천장 자체는 이미 결론이 나 있다 — [crag-term-weight-tuning §10](./crag-term-weight-tuning-v1.md) 이 구조적 천장 43%를 근거로 `availability` 항을 감점 전용으로 바꿨다.

남아 있던 우회로는 하나였다: KTO `searchKeyword2`(이름) + 좌표 대조 + `detailIntro2` **역조회**. [`resolveOpeningHours`](../../apps/api/src/planner/retrieval/tour-api.service.ts) 가 수동 추가 장소에 쓰는 경로를 카카오 행 전체에 돌리는 안이다. 그래서 실제로 재봤다 — 무작위 30건(카테고리별 10), KTO 33콜.

| 카테고리 | 성공 | 실패 내역 |
| --- | --- | --- |
| attraction | 1/10 | 검색 0건 7 · 좌표 반경 밖 1 · 파싱 실패 1 |
| restaurant | 1/10 | 검색 0건 7 · 좌표 반경 밖 2 |
| cafe | 0/10 | 검색 0건 9 · 좌표 반경 밖 1 |
| **합계** | **2/30 (6.7%)** | |

실패의 압도적 다수(23/30)가 **searchKeyword2 검색 0건** = KTO 미등록이다. 표본을 보면 당연하다 — 투썸플레이스 인천효성점·쿠우쿠우 청주점 같은 프랜차이즈 지점, 커런트커피·트이어·소드락이 같은 개인 가게, 갤러리M·장고개골 같은 소규모 지점. 이게 정확히 **카카오 소스를 붙인 이유**(카카오 전용 장소 보강)라, 그 행들이 KTO 에 없는 건 구조적으로 당연하다.

두 번째 부류(4/30)는 이름은 찾았지만 좌표가 딴 곳이다 — `화심` 185km, `보보` 39km, `백년가야밀면` 110km. 동명 타지역 장소이고 250m 게이트가 오매칭을 정확히 막았다. **반경을 늘리는 건 답이 아니다.**

성공한 2건 중 `위양지` 는 `00:00-23:59`(상시 개방)라 제약으로 아무 역할을 안 한다. 실제로 제약이 되는 값을 얻은 건 1건(**3.3%**)이다.

**결정: 하지 않는다.**

- 비용 5,846행 × 2콜 = 11,692콜. `searchKeyword2` 는 별도 일 한도(1,000)라 최소 6일, `detailIntro2` 는 적재와 예산을 공유해 더 길어진다. 실패 건도 콜을 다 쓴다(검색 0건 1콜, 반경 밖 1콜).
- 수확 기대 약 390행(6.7%), 유효 제약은 약 190행 → 카탈로그 커버리지 5.3% → 7.1%.
- 같은 예산을 KTO 행 3,943건 백필(1콜/행, `contentid` 이미 있음)에 쓰면 상한이 훨씬 높다. 그쪽도 여행코스·자유 서술 때문에 100%는 아니지만 "등록조차 안 된 장소를 찾는" 실패 모드는 없다.

즉 백로그의 원래 범위(KTO 행 백필)가 맞고, 카카오·popular 쪽은 **고칠 대상이 아니라 소스 특성으로 확정**한다.

## 6. 검증

| 항목 | 결과 |
| --- | --- |
| `tsc --noEmit` | 통과 |
| eslint (변경 파일) | 경고 0 |
| 테스트 | **622건 통과** (신규·갱신 25건) |
| 실적재 1차 | `--regions=속초 --sources=tour,kakao --max=3` → tour 만 건너뛰고 카카오 3건, 신규 1 / 갱신 2 |
| 실적재 2차 (같은 명령) | **유지 3** — 텍스트 해시 안정 확인 |
| `deleteRegion` SQL | 실 DB 트랜잭션 롤백으로 `$4::text[]` 바인딩·삭제 범위 확인 (롤백 후 10,478행 무변화) |
| `findSamePlace` 반경 경계 | 실 데이터에서 150m 흔든 좌표 매칭 1건 / 400m 0건 |
| 커서 환산 | `경상북도 tour` page 3 → offset 200 |

신규 테스트가 붙은 곳: 지역 타깃 해석 4건([place-ingestion.service.spec](../../apps/api/test/planner/retrieval/place-ingestion.service.spec.ts)), 삭제 키·게이트·`findSamePlace` 10건([place-embedding.repository.spec](../../apps/api/test/planner/retrieval/place-embedding.repository.spec.ts)), 오프셋 커서 4건([tour-api.service.spec](../../apps/api/test/planner/retrieval/tour-api.service.spec.ts)), 시군구 코드 3건([region-code.spec](../../apps/api/test/planner/retrieval/region-code.spec.ts)), 숙박 차단 2건([place-eligibility.spec](../../apps/api/test/planner/retrieval/place-eligibility.spec.ts)), 실행 간 중복·해시 안정 4건.

## 7. 남은 것

- **골든셋 재측정** — §3.4 의 텍스트 변경이 카탈로그에 대부분 반영된 뒤에 R\|cat·MRR 을 다시 재야 이전 수치와 비교 가능하다.
- **KTO 예산을 API 별로 분리** — [`KtoCallBudget`](../../apps/api/src/planner/retrieval/tour-api.service.ts) 이 모든 호출을 한 카운터(기본 900)로 센다. data.go.kr 한도는 API 별 1,000이라 `areaBasedList2`·`detailIntro2`·`searchKeyword2` 가 각자 1,000을 가진다. 쪼개면 같은 일수에 실질 처리량이 두세 배다 — 영업시간 백필을 하든 안 하든 선행 조건.
- **지역 순회 순서 고정** — 예산 소진이 항상 KTO 시도 목록 뒷쪽을 자른다. 현재 분포는 493~709행으로 고르니 증상은 없지만, 시작 지역 로테이션이 없다는 사실은 남는다.
- **영업시간 KTO 행 백필 3,943건** — 백로그에 유지(1콜/행 ≈ 5일). 랭킹 이득은 §10 에서 끊겼으므로 화면 배지 목적.
