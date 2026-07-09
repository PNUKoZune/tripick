# TriPick 장소 임베딩 데이터 강화 v1

작업 브랜치: `feat/place-embedding-enrichment`
작성일: 2026-07-09
관련 문서: [`place-embedding-and-preference-personalization-v1.md`](./place-embedding-and-preference-personalization-v1.md) (기반 적재 파이프라인), [`rag-crag-v1.md`](./rag-crag-v1.md)

## 1. 배경 / 문제

기존 적재 파이프라인([place-embedding-and-preference-personalization-v1.md](./place-embedding-and-preference-personalization-v1.md))의 `place_embeddings`에서 네 가지 문제를 발견해 개선했다.

1. **소스 편중.** 카카오는 런타임 `KakaoLocalService.search()`(키워드 1페이지 ≤10건)를 재사용해 수집량이 적어, 관광공사(KTO)에 크게 치우쳐 있었다.
2. **카카오 타지역 누수.** 키워드 검색이 위치 필터 없이 지역명("경주")만 사용해 타지역 동명 장소("경주 밖 경주식당")가 섞였다.
3. **지역 필터 무력화.** 적재는 `destination_region`에 한글 시도명(경상북도)을 저장하는데, 런타임은 `lower(destination_region) = normalizeDestinationRegion()`(영문 슬러그 `gyeongju`)로 비교해 **사실상 매칭이 안 됐고** `name/address ILIKE`에만 의존했다. 시군구 granularity도 없어 "경주" 정밀 필터가 불가능했다.
4. **Insert-only 정체.** `upsertPlace`가 insert-only라 재실행해도 기존 행이 갱신되지 않았다(모델/텍스트 변경은 전체 `--reseed`로만 반영). 임베딩 텍스트 신호도 `name | category | address | tags`로 빈약했고, 이미 가져온 이미지도 버려졌다.

## 2. 변경 요약

| # | 영역 | 내용 |
| --- | --- | --- |
| 1 | 카카오 위치·카테고리 정합 + 반반 | 카카오 적재를 **위치+카테고리 검색**(`search/category`)으로 교체. KTO 좌표 클러스터에서 앵커를 뽑아 반경 내 CT1·AT4·FD6·CE7 순회. budget 을 KTO 와 동일 상한으로 분배해 소스 비중 반반 |
| 2 | 숙박 제외 | KTO `contentTypeId=32`(숙박)은 정규화 단계에서 제외. 카카오는 AD5 미순회 |
| 3 | 지역 라벨 granularity | `region_sigungu` 컬럼 추가(주소 파싱). 런타임 검색을 목적지 어간(`regionStem`) 기반 `region_sigungu`/`destination_region` 매칭으로 교체 |
| 3 | 임베딩 텍스트 강화 | 텍스트에 원본 카테고리 상세(카카오 `category_name` 경로 / KTO 유형명)와 지역(시도·시군구)을 명시 (포맷은 3.3 참고) |
| 4 | 증분 UPSERT + provenance | `text_hash`·`embedding_model`·`image_url`·`updated_at` 추가. insert-only → insert/update. 해시·모델 동일하면 재임베딩 생략(유지), 다르면 갱신 |
| 5 | KTO 법정동 코드 마이그레이션 | 폐기 예정인 `areaCode2`/`areaCode`를 `ldongCode2`/`lDongRegnCd`(법정동 코드)로 교체. `deleteRegion` 삭제 카운트 버그 수정 |
| 6 | append 모드 (페이지 커서) | `ingest_cursors` 테이블에 지역·소스별 다음 페이지 저장. `--append` 로 반복 실행 시 안 읽은 새 페이지부터 이어 적재 → 크론 누적 |

## 3. 상세

### 3.1 카카오 위치+카테고리 검색 (반반 + 누수 차단)

- `KakaoLocalService.searchAround(center, radius, limitPerCategory)`: 앵커 좌표를 중심으로 4개 `category_group_code`(CT1 문화시설·AT4 관광명소·FD6 음식점·CE7 카페)를 `search/category.json`으로 순회. 위치+카테고리 기반이라 키워드 누수가 **구조적으로 불가능**.
- **앵커 도출**: `PlaceIngestionService.deriveAnchors` 가 KTO 장소 좌표를 격자(≈0.1°)로 버킷팅해 밀집 순으로 앵커(관광 중심지)를 뽑는다. KTO 를 먼저 수집하고 그 좌표를 카카오 검색의 중심으로 재사용한다.
- **반반**: 카카오 budget = KTO 와 동일한 `--max`. 앵커·카테고리에 고르게 분배.
- **폴백**: KTO 좌표가 없으면(`--sources=kakao`) `resolveCenter`로 지역명 지오코딩 → 중심 1곳(제한적 커버리지, 경고 로그).
- **런타임 fallback** `search()`는 키워드 검색을 유지하되 `currentLocation`이 있으면 x/y/radius(`KAKAO_SEARCH_RADIUS_M`)로 묶어 이탈·웨이팅 재계획 시 누수 방지.

> 참고: 한국관광공사 **관광지별 연관 관광지(TarRlteTarService1)** API 도입을 검토했으나, (a) 현재 키가 미구독(Forbidden), (b) 응답에 좌표·주소가 없어 적재 소스로 부적합해 이번 범위에서 제외. 향후 AlternativeModule(재계획 대안 후보)에 더 적합.

### 3.2 지역 라벨 granularity (시도 + 시군구)

- `region_sigungu`(예: 경주시)를 주소 파싱(`parseSigungu` — 첫 토큰=시도 건너뛰고 시/군/구 토큰)으로 채운다.
- 런타임 검색은 목적지 어간(`regionStem` — 행정 접미사 제거: '경주'→'경주', '경상북도'→'경상북')으로 `region_sigungu`(프리픽스) 또는 `destination_region` 매칭. "경주"가 우연한 substring 이 아니라 시군구 필터로 정확히 걸린다.

### 3.3 임베딩 텍스트 강화

- 코스 카테고리(attraction) 대신 **원본 카테고리 상세**(카카오 "음식점 > 한식 > 국밥", KTO "문화시설")와 **지역(시도·시군구)**을 텍스트에 명시 → 질의(`destination:… taste:…`)와 토큰이 겹쳐 의미 검색 품질↑. `inferPlaceTags`도 `categoryDetail`을 함께 훑어 태그 신호 확장.

### 3.4 증분 UPSERT + provenance

- `findProvenance(dedupe)`로 기존 행의 `id·text_hash·embedding_model` 조회.
- 적재 루프: 텍스트 해시(sha256) + 현재 모델이 **기존과 동일하면 재임베딩 없이 유지(unchanged)**, 다르면 `upsertPlace(…, existingId)`로 **갱신(updated)**, 없으면 **신규(inserted)**.
- 효과: `--reseed` 없이 텍스트/모델 변경분만 증분 반영, 모델 이관 자동. 재실행 비용(임베딩 호출) 대폭 절감. 버려지던 KTO `firstimage`를 `image_url`로 저장하고, **런타임 검색(`searchByEmbedding` SELECT → `toCandidate` → `PlaceDto.imageUrl`)에서 노출**해 실제 사용되게 했다.

### 3.5 KTO 법정동 코드 마이그레이션

KTO 가 `areaCode`·`sigunguCode`·`cat1~3` 파라미터를 폐기하고 법정동 코드(`lDongRegnCd`·`lDongSignguCd`)·분류체계(`lclsSystm1~3`)로 대체함에 따라, `TourApiService`가 실제로 쓰던 부분을 이전했다.

- `fetchSidoList`: `areaCode2` → **`ldongCode2`** (반환 `code`=`lDongRegnCd`, 예: 서울=11, 경북=47).
- `areaBasedList2` 요청 파라미터: `areaCode` → **`lDongRegnCd`**.
- 시군구는 `sigunguCode`(폐기) 대신 주소 파싱(`parseSigungu`), 카테고리는 폐기 대상이 아닌 `contentTypeId` 매핑을 그대로 사용 → 추가 변경 불필요.
- 부수 수정: `deleteRegion` 이 `DELETE … RETURNING` 결과를 `dataSource.query` 로 받을 때 드라이버가 `[rows, affected]` 를 돌려줘 삭제 카운트가 항상 2로 잘못 집계되던 버그를, CTE(`WITH deleted AS (DELETE … RETURNING 1) SELECT count(*)`)로 수정.
- 라벨 정합: `ldongCode2`가 풀네임('대구광역시')을 주는데 기존 DB는 옛 단축명('대구')이라, `deleteRegion`을 어간 프리픽스(`lower(destination_region) LIKE '대구%'`)로 확장해 **옛/새 라벨을 함께 삭제**한다. 덕분에 전국 재적재 시 TRUNCATE 없이도 옛 라벨 orphan 이 남지 않는다(시도 라벨이라 인접 시도 오삭제 없음: '경상북%'는 경상남도 미포함).

### 3.6 append 모드 (페이지 커서로 반복 실행 = 누적)

기본(비-append) 실행은 KTO `areaBasedList2`를 항상 **page 1부터** 읽어(정렬 `arrange=O` 고정) 매번 같은 상위 N개만 재확인한다 → provenance 가 "유지"로 처리해 **신규가 안 늘어난다**. 카탈로그를 키우려면 `--max`를 올리거나, `--append`로 페이지를 이어 읽어야 한다.

- `ingest_cursors(region, source, next_page)`에 지역·소스별 다음 페이지를 저장.
- `--append`: `fetchByArea`가 커서 페이지부터 `numOfRows=min(max,100)`로 읽고, 다음 커서를 저장한다. 끝에 도달하면 `next_page=1`로 wrap(다음 실행은 상단부터 재확인).
- 카카오는 별도 커서가 없다 — append 시 tour 배치(다른 페이지)의 좌표가 앵커가 되므로 자연히 새 지역을 탐색한다.
- 증분 UPSERT 와 결합돼 겹치는 장소는 재임베딩 없이 유지, 새 페이지의 신규만 임베딩·삽입된다.

**검증**(경상북도, `--max=40 --append` 2회): RUN1 page1→커서2(신규 6/유지 69), RUN2 page2→커서3(신규 39/유지 36). 행수 167→173→212로 **반복 실행마다 누적** 확인.

## 4. 스키마 변경 (`infra/postgres/init.sql`)

`place_embeddings`에 컬럼 추가 (모두 `ALTER TABLE … ADD COLUMN IF NOT EXISTS`로 기존 볼륨 안전):

| 컬럼 | 용도 |
| --- | --- |
| `region_sigungu` | 시군구 정밀 필터 (+ 인덱스) |
| `image_url` | 대표 이미지 (KTO firstimage) |
| `text_hash` | 임베딩 대상 텍스트 해시 → 재임베딩 생략 판정 |
| `embedding_model` | 임베딩 모델 → 모델 전환 감지 |
| `updated_at` | 갱신 시각 |

신규 테이블 `ingest_cursors(region, source, next_page)` — append 모드 페이지 커서.

기존 실행 중 DB 반영:

```bash
docker exec -i tripick-postgres psql -U tripick -d tripick < infra/postgres/init.sql
```

## 5. 설정값 (신규)

| 환경변수 | 기본값 | 설명 |
| --- | --- | --- |
| `KAKAO_SEARCH_RADIUS_M` | `20000` | 런타임 키워드 검색 반경(m). `currentLocation` 있을 때만. 최대 20000 |
| `KAKAO_INGEST_RADIUS_M` | `10000` | 적재 카테고리 검색 반경(m). 앵커 1곳 커버 범위 |
| `KAKAO_INGEST_MAX_ANCHORS` | `8` | 적재 시 시도별 카카오 앵커 최대 개수 |

## 6. 실행 / 재적재

임베딩 텍스트 포맷·스키마가 바뀌었으므로 기존 행 반영은 재적재가 필요하다.

```bash
cd apps/api
# 신규 포맷 + 시군구 + provenance 로 재적재 (지역별 권장)
pnpm ingest:places -- --reseed --regions=경상북도
# 카탈로그 확장: --max 를 키우면 더 깊은 페이지의 신규만 증분 삽입
pnpm ingest:places -- --max=500
# 크론 누적: --append 로 반복 실행하면 매번 다음 페이지를 이어 적재
pnpm ingest:places -- --append --max=100
```

> **누적 방식**: 같은 `--max`로 비-append 재실행은 신규가 안 늘어난다(항상 상위 N개 재확인). 늘리려면 `--max`를 키우거나 `--append`(페이지 커서)로 돌린다. 라벨 정합 덕에 전국 재적재도 TRUNCATE 없이 안전하다.

## 7. 검증

- **유닛테스트**: 9 suites / 33 tests 통과 (`pnpm --filter @tripick/api test`). 신규 `place-seeds.spec.ts`(regionStem·parseSigungu·inferPlaceTags 6개).
- **타입체크**: `tsc --noEmit` 통과.
- **로컬 실적재(경상북도, max=30)**:
  - 소스 반반: 카카오 29 / KTO 30
  - `region_sigungu` 57/59 채움 (경주시 24 외 도 전역 분산)
  - "경주" 매칭 24건 **전부 주소에 경주 포함 — 누수 0**
  - e2e 코사인: "경주 한옥 감성 카페" → 상위 전부 경주시 카페(투썸·카페363·청수당·스타벅스)
  - 증분 UPSERT: 재실행 시 59건 전부 '갱신'(provenance 채움) → 한 번 더 실행 시 59건 전부 '유지'(재임베딩 0). provenance·image_url 채워짐 확인.

## 8. 변경 파일

| 파일 | 변경 |
| --- | --- |
| `kakao-local.service.ts` | `searchAround`(카테고리 검색)·`resolveCenter`·키워드 x/y/radius·category_group_code |
| `tour-api.service.ts` | 법정동 코드(ldongCode2·lDongRegnCd) 이전, 숙박 제외, 유형명(categoryDetail)·시군구(parseSigungu) |
| `place-ingestion.service.ts` | 앵커 도출·반반 분배, 텍스트 강화, 증분 UPSERT 루프 |
| `place-embedding.repository.ts` | 지역 어간/시군구 검색 필터, `findProvenance`, insert/update `upsertPlace`, image_url 노출, deleteRegion 라벨 정합 |
| `ingest-cursor.repository.ts` | (신규) append 페이지 커서 저장소 |
| `place-ingestion.module.ts` | IngestCursorRepository 등록 |
| `place-seeds.ts` | `regionStem`·`parseSigungu`, `inferPlaceTags` categoryDetail |
| `ingestion.types.ts` / `types.ts` | `sigungu`·`categoryDetail`·`updated`/`unchanged` 필드 |
| `ingest-places.ts` | 요약 신규/갱신/유지 출력 |
| `infra/postgres/init.sql` | 컬럼·인덱스 추가 |
| `.env.example` | 카카오 반경·앵커 설정 |

## 9. 후속 과제 (미포함)

- **영업시간 등 제약 데이터 적재**(KTO `detailIntro2`) → Constraint Engine 이 실데이터로 동작 (Tier 1)
- **검색 품질 평가 하네스**(golden set) → blend weight·radius·카테고리 비중 튜닝 (Tier 3)
- **ANN 스케일**: 대규모에서 `ILIKE OR NULL` 필터가 HNSW 활용 저해 → 정규화 region 코드 pre-filter (Tier 3)
- 전국 재적재 (현재 경상북도만 실적재 검증)
