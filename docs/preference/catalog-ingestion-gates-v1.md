# TriPick 카탈로그 적재 게이트 v1

문서 목적: 반경 검색이 붙으면서 드러난 카탈로그 오염 세 부류를 닫는다. 후보 풀이 시도 전역일 때는 묻혀 있던 것들이 2km 반경에서는 결과를 통째로 먹는다. 공통 원칙은 **적재 게이트와 검색 게이트가 같은 함수로 같은 판정을 내려야 한다**는 것 — 어긋나면 "저장은 되는데 검색엔 절대 안 나오는 행"이 쌓이고, 정리해도 재적재가 되돌려 놓는다.

작업 브랜치: `feat/destination-anchor-retrieval`
작성일: 2026-08-17
관련 문서: [`catalog-name-quality-v1.md`](./catalog-name-quality-v1.md) (SEO 상호·여행코스 기사 — 같은 계열의 선행 작업), [`place-catalog-integrity-v1.md`](./place-catalog-integrity-v1.md), [`destination-anchor-retrieval-v1.md`](./destination-anchor-retrieval-v1.md) (이 문제가 드러난 경로)

---

## 1. KTO 쇼핑(38) 소매 점포

### 1.1 문제

[`CONTENT_TYPE_CATEGORY`](../../apps/api/src/planner/retrieval/tour-api.service.ts) 가 쇼핑(contentTypeId=38)을 `attraction` 으로 접는다. 그래서 백화점 입점 브랜드 매장이 "관광지"로 적재돼 있었다.

```
구찌 롯데백화점 부산본점       | attraction | 부산 부산진구 가야대로 772 (부전동)
다이소 부산서면점              | attraction | 부산 부산진구 중앙대로702번길 43 (부전동) B1층
올리브영 울산삼산대로점         | attraction | 울산 남구 …
```

**반경 검색이 붙자 이게 결과를 먹었다** — 서면역 2km 후보 33건 중 **9건이 롯데백화점 입점 브랜드**였다. 시도 전역 검색일 때는 부산 643건 중 23건이라 3.6% 로 묻혀 있던 비율이 27% 로 드러난 것이다.

### 1.2 쇼핑 버킷을 통째로 버릴 수는 없다

전통시장이 같은 버킷에 있고, 그건 취향 기반 추천의 정당한 후보다 — '경주 중앙시장'·'강경젓갈시장'·'광양5일장 (1, 6일)'·'견지동 불교용품거리'.

카탈로그 내 쇼핑 818건을 실측해 두 신호로 갈랐다([`isRetailBranchOutlet`](../../apps/api/src/planner/retrieval/place-name-quality.ts)):

| 신호 | 건수 | 예시 |
| --- | --- | --- |
| 이름이 체인 지점 접미(`… 지역점`)로 끝남 | 588 | 다이소 부산서면점, 게스 롯데프리미엄아울렛 동부산점 |
| 주소에 층 표기 | 382 | …(부전동) B1층, …본관 4층, …S타워 9,10층 |
| **합집합 = 제거** | **635** | |
| **유지** | **183** | 시장·오일장·상점가 |

단일 어절로 '점'으로 끝나는 이름은 **하나도 없었다** — 588건 전부 `BRAND 지역점` 형태라 접미 규칙이 깨끗하게 갈린다.

### 1.3 ⚠️ 쇼핑 버킷 안에서만 돌려야 한다

이 규칙을 카탈로그 전체에 적용하면 카카오 소스 카페·식당 지점('스타벅스 해운대점')이 함께 죽는데, **그건 실제로 일정에 넣는 장소다.** 음식점은 contentTypeId=39, 카페는 카카오 소스라 38 로 좁히면 위험이 사라진다. [`toIngestPlace`](../../apps/api/src/planner/retrieval/tour-api.service.ts) 에서 여행코스 기사와 같은 방식(타입 확인 후 이름·주소 모양)으로 막는다.

이미 들어온 행은 `pnpm cleanup:catalog -- --only=retail` 로 걷는다. 정리 CLI 는 KTO 에 쇼핑 목록을 되물어(`areaBasedList2` contentTypeId=38) 범위를 좁힌 뒤 판정한다 — 모양만 보면 갈리지 않기 때문이다.

## 2. KTO 축제공연행사(15) 기간

### 2.1 축제는 장소가 아니라 이벤트다

카탈로그가 그걸 몰라 **이미 끝난 행사**가 일반 장소와 똑같이 후보로 올라왔다. 부산 적재 후 실측:

```
2025 영호남 전통시장 박람회   2025-10-31 ~ 2025-11-02   ← 9개월 전 종료
해운대 모래축제              2026-05-15 ~ 2026-05-18   ← 3개월 전 종료
광안리어방축제               2026-06-12 ~ 2026-06-14   ← 2개월 전 종료
광안리 M 드론 라이트쇼        2026-01-01 ~ 2026-12-31   ← 상시, 유효
```

부산 축제 71건 중 **59건(83%)이 종료된 행사**였고, `해운대 모래축제` 가 골든셋 busan-beach 상위 16 안에 들어와 있었다.

### 2.2 적재가 아니라 **검색 시점**에 판정한다

적재 시점에 "끝난 것"만 빼면 **오늘 적재한 8월 축제를 10월 여행 후보로 내주게 된다.** 기간이 있는 데이터는 기간을 저장하고 소비 시점(여행 날짜)에 판정해야 한다. 마이그레이션 [`1786400000000-AddPlaceEventPeriod`](../../apps/api/src/database/migrations/1786400000000-AddPlaceEventPeriod.ts) 이 `event_start_date`/`event_end_date` 를 만들고, 검색이 여행 날짜 구간과 겹칠 때만 남긴다. **NULL 은 기간 없음 = 상시**라 축제가 아닌 행에는 아무 영향이 없다.

끝난 행사 행을 지우지도 않는다. 연례 축제는 KTO 가 같은 contentId 의 날짜를 갱신하므로, 지웠다 다시 넣으면 임베딩만 매년 새로 태우게 된다.

### 2.3 기간을 어디서 받나

목록 API(`areaBasedList2`)는 `eventstartdate`/`eventenddate` 를 **주지 않는다**(응답 필드를 열어 확인). `detailIntro2` 로 받으면 건당 1콜이라 전국 1,200여 건에 그만큼 들지만, `searchFestival2` 는 같은 값을 **목록으로** 준다(시도당 1~2콜). 부산 71건 = areaBasedList2 의 축제 총수와 정확히 일치해 커버리지 손실도 없다.

`eventStartDate` 파라미터는 **시작일 기준 필터**라 값이 오늘에 가까우면 "오래전 시작해 아직 진행 중인 장기 행사"가 통째로 빠진다. 과거로 충분히 밀어 전량을 받는다(부산 실측: 19000101·20200101 둘 다 71건으로 동일).

### 2.4 ⚠️ 증분 적재가 기간을 건너뛴다

첫 재적재에서 `축제 기간 71/71건 채움` 이 찍혔는데 **DB 에는 0건**이었다. 텍스트 해시가 같으면 증분 적재가 `upsertPlace` 를 통째로 건너뛰는데, **기간은 임베딩 텍스트 밖이라 해시가 안 변한다.** 영업시간이 이미 같은 이유로 별도 backfill 경로를 갖고 있었고, 기간도 같은 처리가 필요했다(`updateEventPeriod`).

기간 쪽이 더 중요하다 — 영업시간은 한 번 채우면 잘 안 바뀌지만 **연례 축제는 같은 contentId 의 날짜가 매년 바뀐다.** 이 경로가 없으면 작년 날짜에 갇혀 그 축제가 영영 안 보이게 된다.

날짜는 `to_char` 로 문자열로 읽는다 — pg 드라이버가 `date` 를 로컬 자정 Date 로 파싱해 UTC 컨테이너에서 하루가 밀리는 함정이 있다(이 저장소가 `offsetDate` 주석에 남긴 것과 같은 종류).

### 2.5 방문 구간은 `startAt` 과 별개다

[`RetrievalContext.visitWindow`](../../apps/api/src/planner/retrieval/types.ts) 를 새로 뒀다. `startAt` 은 "그 시각에 문을 여는가"(영업시간·가용성 점수)를 보는 **시각**이고, `visitWindow` 는 "그 날짜에 열리는 행사인가"를 보는 **날짜 구간**이다. 하나로 합치면 둘 중 하나가 틀어진다 — 일자별 재계획은 하루짜리 구간이 필요한데 `startAt` 은 첫 일차 기준으로 공유된다.

- 단일 풀 경로: 다시 짜는 첫~마지막 일차 (시작일만 보면 3일차에 열리는 축제가 통째로 빠진다)
- 일자별 경로: 그 일차 하루

## 3. 적재 게이트 = 검색 게이트

### 3.1 문제

적재는 SEO 상호만 걸렀고([`isSeoBusinessName`](../../apps/api/src/planner/retrieval/place-name-quality.ts)), 검색이 쓰는 정본 게이트([`isEligibleItineraryCandidate`](../../apps/api/src/planner/retrieval/place-eligibility.ts))는 안 돌았다. 그래서 검색이 절대 후보로 안 쓰는 행이 적재만 되고 쌓였고, **정리 CLI 로 걷어내도 재적재가 그대로 되돌려 놨다** — 부산 재적재 후 13건 재유입(약국 11·성형외과 1·근대건축물 1).

### 3.2 ⚠️ `categoryDetail` 을 넘기면 안 된다

`isEligibleItineraryCandidate` 는 소스가 준 카테고리를 이름보다 우선한다(`쇼핑`·`관광` 등이면 통과). 적재 시점엔 `IngestPlace.categoryDetail` 이 있으니 넘길 수 있는데, **일부러 안 넘긴다.**

`place_embeddings` 가 그 값을 저장하지 않아 **검색 단계의 pgvector 후보에는 categoryDetail 이 없다.** 적재만 그걸 보면 게이트가 검색보다 후해져서, "저장은 되는데 검색엔 절대 안 나오는 행"이 계속 생긴다 — 지금 고치려는 문제가 정확히 그것이다.

원칙: **적재 판정은 그 행이 저장된 모습 그대로 검색에서 어떻게 판정될지를 예측해야 한다.**

### 3.3 ⚠️ 이름 기반 의료 필터의 오탈락

`EXCLUDED_CATEGORY_KEYWORDS` 는 이름 포함으로 판정해 실제 관광지를 함께 죽인다:

- **'부산 구 백제병원'** — 등록문화재 근대건축물
- **'충북대학교병원 치유의나눔길'** — 산책로

KTO 는 이 둘을 **관광지(12)**, 약국을 **쇼핑(38)** 으로 주므로 소스 카테고리를 저장하면 갈릴 수 있다. 다만 **'더바디성형외과의원'도 관광지(12)** 라(의료관광 분류) 그것만으론 부족하다. 이 오탈락은 이번 변경이 만든 게 아니다 — 검색 게이트가 원래 거부하던 행이라 결과에는 처음부터 안 나왔고, 카탈로그에서 사라진 것뿐이다. 제대로 고치려면 `category_detail` 컬럼 추가(마이그레이션 + 재적재) + 이름 규칙 정밀화가 필요하다.

## 4. 검증

| 항목 | 결과 |
| --- | --- |
| 쇼핑 소매 점포 | 818건 중 635 제거 / 183 유지. 카탈로그 10,333 → 9,687행 |
| 서면역 앵커 결과 | 백화점 입점 매장 **6/8 → 0/8** (서면밀면·부산시민공원·개금밀면·서면교차로·삼광사로 교체) |
| 축제 기간 | 부산 71건 채움(종료 59 / 유효 12). 오늘 기준 해운대·부산 후보 40건에 행사 0건, 모래축제 기간(2026-05-16~18)으로 조회하면 해당 축제만 복귀 |
| 적재 게이트 | 13건 정리 후 재적재에서 dedupe 1260 → 1247(정확히 13건 차단), 신규 0, 잔여 부적합 0건 |
| 골든셋 회귀 | 쇼핑 정리 시 14케이스 지표 전부 동일(시도 단위 목적지라 소매 점포가 애초에 상위에 못 옴) |

## 5. 배포 환경 반영 (별도 작업)

마이그레이션은 부팅 시 자동 적용되지만(`migrationsRun: !isDevelopment`) **카탈로그 데이터는 저절로 안 고쳐진다.** 무엇이 코드만으로 되고 무엇이 데이터 작업인지 갈라 둔다.

### 5.1 배포만으로 즉시 동작

| 변경 | 이유 |
| --- | --- |
| 앵커 해석·반경 검색 | `lat`/`lng` 가 **생성 컬럼**이라 ALTER 시점에 기존 행이 전부 자동으로 채워진다 |
| 앵커 거리 locality · 인지도 판정 게이트 | 순수 점수 계산 |
| 적재 게이트(소매 점포·부적합 장소) | 다음 적재부터 적용 — 이미 들어온 행에는 무효 |
| 태그 사전(봉·바위·굴) | 검색은 `inferPlaceTags` 를 매번 새로 계산한다. 임베딩 텍스트만 옛것이라 급하지 않다 |

⚠️ `event_start_date`/`event_end_date` 는 nullable 이라 부팅은 깨지지 않지만, **기존 행이 NULL = 상시로 읽혀 끝난 축제가 계속 후보로 나온다.** 이 수정은 재적재 없이는 효과가 0 이다.

### 5.2 데이터 작업이 필요한 것

| 항목 | 조치 | KTO 호출 |
| --- | --- | --- |
| 검색 게이트 거부 행(약국·의원) | `cleanup:catalog -- --only=ineligible --apply` | 없음 |
| 쇼핑 소매 점포 | `cleanup:catalog -- --only=retail --apply` | 쇼핑 목록 ~104콜 |
| **축제 기간 backfill** | `ingest:places -- --sources=tour` | 목록 ~505콜 + 축제 ~25콜 |

⚠️ **축제 기간 backfill 은 그 지역 페이지를 다시 읽어야 채워진다.** `--max` 가 작으면 그 범위 밖 축제 행은 NULL 로 남는다. 축제만 콕 집어 채우는 전용 CLI 는 없다 — 전량 적재를 어차피 할 때 함께 처리되는 것을 전제로 한다.

### 5.3 순서

전제: [`deployment-railway-vercel-runpod.md` §8-1](../ops/deployment-railway-vercel-runpod.md) — 임베딩 서버(RunPod)가 먼저 살아 있어야 하고, `DATABASE_URL` 은 Railway 공개 TCP 프록시 주소로 준다.

```bash
# 1) 코드 배포 → 마이그레이션 2건 자동 적용 (lat/lng 생성 컬럼은 이 시점에 기존 행까지 채워진다)

# 2) 검색이 안 쓰는 행 먼저 걷어낸다 (KTO 불필요, 빠름)
pnpm --filter @tripick/api cleanup:catalog -- --only=ineligible --apply

# 3) 전량 적재 — 축제 기간 backfill + 태그 변경분 재임베딩이 여기서 함께 처리된다
#    ⚠️ 영업시간은 반드시 끈다: 켜면 건당 1콜이라 전국 48,857건 = 예산 900/일 기준 54일
KTO_FETCH_OPENING_HOURS=false pnpm --filter @tripick/api ingest:places -- --sources=tour --max=10000

# 4) 적재 게이트는 신규만 막는다 — 이미 들어간 소매 점포는 여기서 걷는다
pnpm --filter @tripick/api cleanup:catalog -- --only=retail --apply
```

호출 예산 합계 ~634콜로 하루(API별 1000) 안에 들어간다. 임베딩은 실측 103건/초라 48,857건이 약 8분이고, DB 는 1024차 벡터 기준 약 200MB 늘어난다.

### 5.4 검증

```sql
-- 축제 기간이 채워졌는지 (NULL 이면 backfill 이 그 행에 안 닿았다)
SELECT count(*) FILTER (WHERE event_end_date IS NOT NULL) AS 기간있음,
       count(*) FILTER (WHERE event_end_date < current_date) AS 종료됨
FROM place_embeddings;

-- 소매 점포·부적합 잔여
SELECT count(*) FROM place_embeddings WHERE name ~ '(백화점|아울렛)' AND name ~ '점$';
```

`pnpm eval:retrieval` 로 기준선을 다시 잡는다 — 커버리지가 74% 에서 올라가면 이전 지표와 직접 비교할 수 없다([`retrieval-eval-harness-hardening-v1.md` §5](./retrieval-eval-harness-hardening-v1.md)).

## 6. 정리 CLI

[`cleanup-catalog.ts`](../../apps/api/src/scripts/cleanup-catalog.ts) 에 두 부류를 추가했다.

```bash
cd apps/api
pnpm cleanup:catalog                              # dry-run — 무엇을 지울지만 보고
pnpm cleanup:catalog -- --only=retail --apply     # 쇼핑 소매 점포
pnpm cleanup:catalog -- --only=ineligible --apply # 검색 게이트가 이미 거부하는 나머지
```

`ineligible` 은 검색 게이트를 그대로 되물어 보는 catch-all 이라 앞 부류(seo·coords·lodging)와 겹친다. **맨 뒤에 두고** 이미 잡힌 행을 빼서, 보고서에 "그 외 무엇이 남아 있었나"만 남게 했다.
