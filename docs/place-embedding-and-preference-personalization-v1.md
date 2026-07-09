# TriPick 장소·취향 임베딩 파이프라인 & 개인화 v1

기준 브랜치: `feat/place-embedding-and-preference-personalization`
작성일: 2026-07-06
관련 문서: [`docs/rag-crag-v1.md`](./rag-crag-v1.md) (CRAG retrieval orchestration 기반)

## 1. 목적

RAG/CRAG planner([`rag-crag-v1.md`](./rag-crag-v1.md)) 위에서 세 가지를 완성한다.

1. **장소 임베딩 적재 파이프라인.** 카카오 로컬 + 한국관광공사(KorService2) 장소를 수집→정규화→중복제거→임베딩→`place_embeddings`에 멱등 적재하는 CLI 파이프라인. 그동안 seed catalog(하드코딩 6개/지역)만으로 채우던 pgvector 검색 후보를 실데이터로 확장한다.
2. **취향 임베딩 개인화 루프.** 기존에는 `preference_embeddings`에 벡터를 저장만 하고 어디서도 읽지 않았다(orphan write). 저장된 취향 벡터를 place 검색에 실제로 반영(블렌딩 + 리랭킹)해 루프를 닫는다.
3. **취향 입력 확장.** 관심 테마·여행 페이스·활동 강도·분위기 선호를 추가해 개인화 벡터를 풍부하게 만든다.

핵심 흐름: **실장소를 임베딩해 적재 → 취향을 구체적으로 받아 취향 벡터 생성 → 그 벡터로 place 검색을 개인화.**

## 2. 구현 파일

### 장소 임베딩 적재 파이프라인

| 파일 | 역할 |
| --- | --- |
| `apps/api/src/planner/retrieval/tour-api.service.ts` | 한국관광공사 KorService2 `areaCode2`(시도 목록) + `areaBasedList2`(지역 장소) 수집 |
| `apps/api/src/planner/retrieval/kakao-local.service.ts` | 카카오 로컬 키워드 검색 (런타임 fallback 겸 적재 소스) |
| `apps/api/src/planner/retrieval/ingestion.types.ts` | `IngestPlace`, `IngestRegionResult`, `IngestSummary` 등 적재 타입 |
| `apps/api/src/planner/retrieval/place-ingestion.service.ts` | 수집→정규화→dedupe→임베딩→upsert 오케스트레이터. `--reseed` 지원 |
| `apps/api/src/planner/retrieval/place-ingestion.module.ts` | 적재 CLI 전용 경량 모듈 (BullMQ/Redis 없이 ConfigModule + DataSource) |
| `apps/api/src/planner/retrieval/place-embedding.repository.ts` | `place_embeddings` pgvector 검색·멱등 적재(`upsertPlace`)·`deleteRegion`(재시드) |
| `apps/api/src/scripts/ingest-places.ts` | `pnpm ingest:places` CLI (`--regions`, `--sources`, `--max`, `--reseed`) |

### 취향 임베딩 개인화 & 확장

| 파일 | 역할 |
| --- | --- |
| `packages/types/src/preference.ts` | `InterestPreference`, `TravelPace`, `ActivityIntensity`, `CrowdPreference` 추가 및 `PreferenceProfileDto` 확장 |
| `infra/postgres/init.sql` | `preference_embeddings`에 `user_id`(unique)·`updated_at` 추가 → 유저당 1행 upsert |
| `apps/api/src/embedding/embedding.module.ts` | `TextEmbeddingService`를 planner·preferences 공용 provider 로 노출 (순환참조 회피) |
| `apps/api/src/embedding/text-embedding.service.ts` | 텍스트→벡터 공용 서비스 (원격 `/embeddings` → 실패 시 결정적 해시 폴백) |
| `apps/api/src/preferences/preference-text.ts` | 취향 태그+프로필을 place 태그 어휘(영문 enum)+한국어 키워드로 직렬화 |
| `apps/api/src/preferences/preference-embedding.repository.ts` | `preference_embeddings` 유저당 1행 upsert / 벡터 조회 |
| `apps/api/src/preferences/preferences.service.ts` | `upsert` 시 취향 임베딩 생성·저장, `getPreferenceVector` 추가 |
| `apps/api/src/preferences/preference-reembed.{service,module}.ts` | `reembed:preferences` — 전체 취향 재임베딩 (place `--reseed`와 짝) |
| `apps/api/src/scripts/reembed-preferences.ts` | 취향 재임베딩 CLI |
| `apps/api/src/planner/retrieval/place-retrieval.service.ts` | 질의 벡터 × 취향 벡터 블렌딩 + 차원 가드 |
| `apps/api/src/planner/retrieval/place-embedding.repository.ts` | 취향 벡터 전달 시 후보별 취향 코사인 동시 계산 |
| `apps/api/src/planner/retrieval/crag-evaluator.service.ts` | taste 점수를 태그 매칭 + 취향 벡터 코사인으로 리랭킹 |
| `apps/api/src/planner/planner.service.ts` | 저장된 취향 벡터를 로드해 retrieval context 로 전달 |
| `apps/web/src/entities/preferences/**`, `features/preference-setup/**` | 관심 테마·페이스·강도·분위기 입력 UI + 매핑 |

## 3. 장소 임베딩 적재 파이프라인

오프라인 CLI(`pnpm ingest:places`)로 `place_embeddings`를 채운다. 런타임 검색은 이 테이블을 pgvector로 조회한다(CRAG orchestration 상세는 [`rag-crag-v1.md`](./rag-crag-v1.md) 참고).

```mermaid
flowchart TD
  A["pnpm ingest:places (--regions/--sources/--max/--reseed)"] --> B["TourApiService.fetchSidoList"]
  B --> C{"지역별 반복"}
  C --> D["TourApiService.fetchByArea (KorService2)"]
  D --> D2["관광공사 좌표로 앵커 클러스터 도출"]
  D2 --> E["KakaoLocalService.searchAround<br/>(앵커별 카테고리 검색 CT1·AT4·FD6·CE7)"]
  D --> F["정규화 IngestPlace"]
  E --> F
  F --> G["dedupe: ID + 이름·좌표(≈100m)"]
  G --> H["TextEmbeddingService.embed(name|category|address|tags)"]
  H --> I["upsertPlace → place_embeddings (멱등)"]
```

### 3.1 소스 수집

- **한국관광공사 KorService2** (`TourApiService`): `areaCode2`로 시도 코드 목록, `areaBasedList2`로 시도별 장소(contentid, 좌표, 주소, contentTypeId→category). `KTO_API_KEY` 필요, 페이지네이션(numOfRows=100), 좌표 0/비유효·제목 없음은 제외.
- **카카오 로컬** (`KakaoLocalService.searchAround`): **위치+카테고리 기반 카테고리 검색**(`search/category.json`). 관광공사가 먼저 수집한 좌표를 격자(≈0.1°)로 버킷팅해 밀집 순 **앵커**(관광 중심지)를 뽑고, 앵커별로 4개 `category_group_code`(CT1 문화시설·AT4 관광명소·FD6 음식점·CE7 카페)를 반경(`KAKAO_INGEST_RADIUS_M`) 안에서 순회한다. 키워드 검색과 달리 x/y/radius 로 지역이 묶여 **타지역 동명 장소(예: 경주 밖 "경주식당")가 섞이지 않는다**. `KAKAO_LOCAL_API_KEY`(또는 `KAKAO_REST_API_KEY`) 필요.
  - **소스 비중(반반)**: 카카오 budget 을 관광공사와 동일한 `--max` 상한으로 두고 앵커·카테고리에 고르게 분배해, 그동안 키워드 검색 단일 페이지로 소수만 수집돼 관광공사에 치우치던 문제를 해소한다.
  - **관광공사 좌표가 없을 때**(`--sources=kakao` 등): `resolveCenter`로 지역명을 지오코딩해 중심 1곳(반경 내)만으로 폴백하며, 커버리지 제한을 경고 로그로 남긴다.
  - **런타임 fallback** `KakaoLocalService.search`는 키워드 검색을 유지하되, `currentLocation`이 있으면 x/y/radius(`KAKAO_SEARCH_RADIUS_M`)로 묶어 이탈·웨이팅 재계획 시 타지역 누수를 막는다.

### 3.2 정규화·중복 제거

수집 결과를 `IngestPlace`로 정규화한 뒤 dedupe:

- **ID 기준**: `kakao_place_id` > `tourism_api_id`
- **이름+좌표 기준**: `정규화이름@lat,lng(소수3자리, ≈100m)` — 소스가 달라(관광공사 vs 카카오) ID가 다른 **같은 물리적 장소**를 하나로 합침

### 3.3 임베딩·멱등 적재 (`upsertPlace`)

임베딩 텍스트는 `name | categoryDetail | 지역: 시도 시군구 | address | 태그: …` 형태로 구성한다. 코스 카테고리(attraction 등) 대신 **원본 카테고리 상세**(카카오 `category_name` 경로 예: "음식점 > 한식 > 국밥", KTO 콘텐츠 유형명 예: "문화시설")를 넣고, **지역(시도·시군구)을 명시**해 질의 텍스트(`destination:… taste:…`)와 토큰이 겹치도록 한다. `inferPlaceTags`도 `categoryDetail`을 함께 훑어 태그 신호를 늘린다. `INSERT ... WHERE NOT EXISTS`로 삽입하며 중복 판정 우선순위: `kakao_place_id` > `tourism_api_id` > `(destination_region, name)`. 이미 있으면 삽입하지 않는다(멱등).

> **임베딩 텍스트 포맷을 바꾸면** 기존 행은 예전 포맷으로 임베딩돼 있어 신규 행과 신호가 어긋난다. 전체 반영은 `--reseed`로 재적재해야 한다(7장).

### 3.4 지역 라벨 granularity (시도 + 시군구)

`place_embeddings`는 시도 라벨(`destination_region`, 예: '경상북도')에 더해 **시군구 라벨(`region_sigungu`, 예: '경주시')**을 저장한다. 시군구는 주소에서 파싱(`parseSigungu`)한다(첫 토큰=시도 건너뛰고 시/군/구로 끝나는 토큰).

런타임 검색은 목적지 어간(`regionStem` — 행정 접미사 제거, 예: '경주'→'경주', '경상북도'→'경상북')으로 `region_sigungu`(프리픽스) 또는 `destination_region`을 매칭한다. 이전에는 `lower(destination_region) = normalizeDestinationRegion()`(영문 슬러그)로 비교해 **한글 시도명과 영문 슬러그가 어긋나 사실상 무력**했고 `name/address ILIKE`에만 의존했다. 이제 "경주"가 우연한 substring이 아니라 시군구 필터로 정확히 걸린다.

### 3.5 CLI 옵션

```bash
cd apps/api
pnpm ingest:places                                   # 전국 시도, 두 소스 모두
pnpm ingest:places -- --regions=서울,부산 --sources=tour,kakao --max=100
pnpm ingest:places -- --reseed --regions=서울         # 재시드(아래 7장)
pnpm ingest:places -- --allow-hash                   # 임베딩 서버 없이 강행(아래 8장)
```

### 3.6 임베딩 서버 안전장치

임베딩 서버가 죽어 있거나 URL 이 틀리면 `TextEmbeddingService`가 **조용히 해시 폴백**으로 벡터를 만든다. 그대로 두면 해시 벡터가 실제 벡터와 섞여 검색 품질이 손상된다. 이를 막기 위해:

- 적재 시작 전 **프리플라이트 헬스체크**: 실제 remote 임베딩이 오지 않으면 적재를 **중단**한다.
- 적재 도중에도 각 임베딩이 해시로 폴백하면(1회 재시도 후에도) 중단한다 — 이미 적재된 실제 벡터 행은 유지되므로 서버 복구 후 재실행하면 된다.
- 의도한 오프라인 적재는 `--allow-hash` 로 우회. 같은 안전장치가 `reembed:preferences` 에도 적용된다.
- 판정 근거: `TextEmbeddingService.embedWithSource()` 가 벡터와 함께 출처(`remote`/`hash`)를 반환한다.

## 4. 개인화 검색 흐름 (런타임)

```mermaid
flowchart TD
  A["취향 저장 (PUT /preferences · 이미지 업로드)"] --> B["buildPreferenceText<br/>(tasteTags + profile)"]
  B --> C["TextEmbeddingService.embed"]
  C --> D["preference_embeddings upsert<br/>(user_id 유저당 1행)"]

  E["PlannerService.generateItinerary / replan"] --> F["getPreferenceVector(userId)"]
  F --> G["PlaceRetrievalService.retrieve"]
  G --> H["질의 벡터 × 취향 벡터 블렌딩<br/>(PREFERENCE_BLEND_WEIGHT)"]
  H --> I["pgvector 검색 (place_embeddings)<br/>+ 후보별 취향 코사인 동시 계산"]
  I --> J["CRAG evaluator<br/>taste = 0.45·태그 + 0.55·취향벡터"]
  J --> K["Top diverse 후보 → LLM planner agent"]
```

## 5. 개인화 방식 상세 (블렌딩 + 리랭킹)

### 5.1 질의 벡터 블렌딩

`PlaceRetrievalService`가 목적지·이벤트·취향키워드 텍스트로 만든 질의 벡터에 저장된 취향 벡터를 가중 결합한다.

```
search = normalize(query · w + preference · (1 - w))   // w = PREFERENCE_BLEND_WEIGHT (기본 0.6)
```

목적지 관련성(질의)을 조금 더 높게 두고, 취향 벡터가 검색 자체를 개인화한다. 취향 벡터가 없거나 차원이 다르면 순수 질의 벡터로 폴백.

### 5.2 CRAG 리랭킹

`place_embeddings` 검색 시 취향 벡터를 넘기면 SQL 에서 후보별 `1 - (embedding <=> preference)`를 함께 계산해 `preferenceSimilarity`로 반환한다. CRAG evaluator 는 이 값을 0~1 로 정규화한 `personalization` 점수를 만들고, taste 점수를 리랭킹한다.

```
taste = clamp(0.45 · 태그매칭점수 + 0.55 · personalization)   // 취향 벡터가 있을 때
```

pgvector 후보에만 벡터 유사도가 있으므로, kakao/seed fallback 후보는 기존 태그 매칭 점수를 그대로 쓴다.

## 6. 취향 확장 (신규 입력 차원)

| 차원 | 타입 | 값 | 비고 |
| --- | --- | --- | --- |
| 관심 테마 | `InterestPreference[]` | history, art, nature, nightview, photo, shopping, food, activity, cafe, local | 다중 선택, `INTEREST_TO_TASTE`로 tasteTags 파생 |
| 여행 페이스 | `TravelPace` | packed, balanced, relaxed | 단일 선택 |
| 활동 강도 | `ActivityIntensity` | active, moderate, restful | 단일 선택 |
| 분위기 선호 | `CrowdPreference` | hotspot, balanced, quiet | 단일 선택 |

신규 차원은 `buildPreferenceText`에서 place 태그 어휘(영문 enum)와 한국어 키워드로 직렬화되어 취향 임베딩 텍스트를 구성한다. (예산 차원은 이번 범위 제외)

## 7. 임베딩 공간 정합성 & 재시드

취향 벡터와 place 벡터는 **같은 임베딩 공간**에 있어야 코사인·블렌딩이 의미를 갖는다. 둘 다 `TextEmbeddingService`를 타므로 원격 임베딩 서버가 있으면 실제 임베딩, 없으면 결정적 해시 임베딩으로 **일관되게** 만들어진다.

문제는 place 적재(`upsertPlace`)가 **insert-only** 라서, 해시 임베딩으로 채운 뒤 임베딩 서버를 켜도 기존 place 행이 갱신되지 않는다는 점이다(취향 벡터만 실제 임베딩 → 공간 어긋남, 차원 1536 동일해 에러 없이 품질만 저하).

**place 재시드** — 적재 CLI `--reseed`:

```bash
cd apps/api && pnpm ingest:places -- --reseed --regions=서울,부산
```

- `PlaceEmbeddingRepository.deleteRegion(region)` 이 적재 라벨(예: '서울특별시')과 seed 정규화 라벨(예: 'seoul')을 **모두** 삭제 후 다시 채운다.
- `--reseed` 없으면 기존 멱등 insert-only. 전체 초기화는 `TRUNCATE place_embeddings` 도 가능.

**취향 재시드** — place 만 재시드하면 취향 벡터는 예전 공간에 남아 비대칭이 된다. 짝이 되는 CLI:

```bash
cd apps/api && pnpm reembed:preferences
```

- `preferences` 테이블의 모든 취향(`tasteTags`+`profile`)을 `buildPreferenceText`로 재직렬화 → 현재 임베딩 소스로 재임베딩 → `preference_embeddings` + `embeddingId` 갱신. 신호 없는 취향은 skip.
- **임베딩 서버 전환 시 두 CLI 를 함께 실행**한다.

**차원 불일치 방어** — `place-retrieval.service.ts` 는 취향 벡터 차원이 질의 벡터와 다르면 개인화를 건너뛴다(경고 로그). 예전 차원 벡터가 pgvector 코사인을 통째로 실패시켜 검색 결과가 사라지는 것을 막는다. 경고가 뜨면 `reembed:preferences` 로 해결.

## 8. 검색 신호 품질

- **어휘 정합성**: `buildPreferenceText` 는 스타일·관심 테마를 place 태그와 같은 **영문 enum**(`STYLE_TAGS`/`INTEREST_TAGS`)으로도 병기해 해시 폴백에서도 취향↔place 토큰이 겹치게 한다.
- **중립값/빈 취향**: 페이스·강도·분위기의 중립 기본값(balanced/moderate)은 토큰을 만들지 않는다. 취향 신호가 전혀 없으면 빈 문자열을 반환하고 제네릭 벡터 저장을 skip 해 편향을 피한다.
- **교차 소스 중복**: 적재 dedupe 가 ID 기준 + 이름·좌표(≈100m) 기준으로 관광공사·카카오 중복을 합친다.

## 9. 하위호환 / 폴백

- `preferenceVector`, `preferenceSimilarity`, `personalization`은 모두 optional. 벡터가 없거나 pgvector 검색이 실패하면 기존 키워드 → kakao → seed 폴백이 그대로 동작.
- 임베딩 엔드포인트가 죽어도 결정적 해시 임베딩으로 폴백 → place seed 와 동일 공간 유지.
- 신규 프로필 필드는 백엔드 `DEFAULT_PROFILE`·FE `DEFAULT_PREFERENCE_FORM`에서 기본값이 채워져 기존 jsonb 데이터와 안전 병합.
- KTO/카카오 키가 없으면 적재는 0건 로그 후 종료, 런타임은 seed fallback 으로 동작.

## 10. 설정값

| 환경변수 | 기본값 | 설명 |
| --- | --- | --- |
| `KTO_API_KEY` | — | 한국관광공사 KorService2 키 (적재) |
| `KAKAO_LOCAL_API_KEY` / `KAKAO_REST_API_KEY` | — | 카카오 로컬 키 (적재·런타임 fallback) |
| `KAKAO_SEARCH_RADIUS_M` | `20000` | 런타임 키워드 검색 반경(m). `currentLocation` 있을 때만 적용. 최대 20000 |
| `KAKAO_INGEST_RADIUS_M` | `10000` | 적재 카테고리 검색 반경(m). 앵커 1곳 커버 범위. 최대 20000 |
| `KAKAO_INGEST_MAX_ANCHORS` | `8` | 적재 시 시도별 카카오 앵커(관광공사 좌표 클러스터 중심) 최대 개수 |
| `DATABASE_URL` | `postgresql://tripick:tripick@localhost:5432/tripick` | 적재 CLI DB 연결 |
| `LLM_BASE_URL` / `LLM_API_KEY` | `http://localhost:8080/v1` / `local` | chat/planner LLM 엔드포인트 |
| `LLM_EMBEDDING_BASE_URL` / `LLM_EMBEDDING_API_KEY` | (미설정 시 `LLM_BASE_URL`/`LLM_API_KEY` 폴백) | 임베딩 전용 서버. 별도 포트로 분리할 때 사용 (예: `http://localhost:8081/v1`) |
| `LLM_EMBEDDING_MODEL` | `dragonkue/BGE-m3-ko` | 임베딩 모델명(서빙 스택에 등록된 이름과 일치). place·취향 텍스트가 한국어라 다국어/한국어 모델 권장 |
| `LLM_EMBEDDING_DIMENSIONS` | `1024` | 임베딩 차원. `place_embeddings`/`preference_embeddings`의 `vector(N)` 컬럼과 **반드시 동일** (BGE-m3=1024) |

> **차원 변경 주의**: `vector(N)` 컬럼 차원을 바꾸는 것이므로 `init.sql` 을 실행 중 DB 에 다시 흘려넣어도(`CREATE TABLE IF NOT EXISTS`) 반영되지 않는다. 볼륨을 재초기화(`docker compose down -v && docker compose up -d`)하거나, 임베딩 테이블을 비우고 컬럼 타입을 직접 바꿔야 한다(HNSW 인덱스 drop→ALTER→재생성). 이후 `ingest:places` + `reembed:preferences` 로 새 차원 벡터를 채운다.
| `PREFERENCE_BLEND_WEIGHT` | `0.6` | 질의 벡터 가중치. 1=순수 질의, 0=순수 취향 |
| `PLACE_RETRIEVAL_AUTO_SEED` | `true` | 지역 후보가 없을 때 seed catalog 자동 적재 |
| `CRAG_MIN_CONFIDENCE` / `CRAG_TARGET_CONFIDENCE` | `0.52` / `0.64` | CRAG 후보 채택/충분성 임계값 |

## 11. 검증

- API 유닛테스트: 8 suites / 25 tests 통과 (`pnpm --filter @tripick/api test`)
  - CRAG evaluator 취향 벡터 리랭킹 테스트
  - `buildPreferenceText` 어휘 정합성·빈 취향 테스트
  - `TextEmbeddingService.embedWithSource` remote/hash 출처 판정 테스트
- API·web 타입체크 통과 (`tsc --noEmit`)
- ⚠️ `ingest:places` / `reembed:preferences` 는 로컬 Postgres 실물 실행 미검증 (DB 구동 후 확인 권장)
