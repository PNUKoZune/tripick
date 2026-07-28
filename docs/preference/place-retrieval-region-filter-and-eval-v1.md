# TriPick 장소 검색 지역 pre-filter · 품질 평가 하네스 v1

문서 목적: 장소 검색(pgvector 리트리벌)의 지역 필터를 인덱스 가능한 정본 코드로 바꾼 것과, 랭킹 상수를 근거 있게 고칠 수 있도록 골든셋 평가 하네스를 도입한 작업을 고정한다.

작업 브랜치: `feat/retrieval-region-code-and-eval`
작성일: 2026-07-27
관련 문서: [`place-embedding-enrichment-v1.md`](./place-embedding-enrichment-v1.md) (이 두 항목의 후속 과제 출처), [`place-embedding-and-preference-personalization-v1.md`](./place-embedding-and-preference-personalization-v1.md) (적재 파이프라인), [`rag-crag-v1.md`](../planner/rag-crag-v1.md) (CRAG 랭킹)

## 1. 배경 / 문제

[enrichment 문서 §9](./place-embedding-enrichment-v1.md#L149) 의 후속 과제 중 둘을 처리한다.

1. **ANN 스케일 — 지역 필터가 인덱스를 못 탄다.** 검색이 `destination_region ILIKE '경상북%' OR region_sigungu ILIKE … OR name ILIKE '%경주%' OR address ILIKE …` 로 지역을 좁혔다. ILIKE 는 btree 를 못 쓰므로 플래너에게 남는 선택지는 (a) 전체 스캔 + 정렬, (b) HNSW 근사 이웃을 뽑아 뒤에서 걸러내는 post-filter 뿐이다. (b) 는 지역이 선택적일수록 뽑아온 이웃이 통째로 탈락해 **결과가 조용히 비는** 방향으로 망가진다. 지금은 전국 2천 건이라 (a) 로 버티지만, 커버리지를 키우는 순간 드러난다.
2. **검색 품질을 측정할 방법이 없다.** `PREFERENCE_BLEND_WEIGHT`(0.6)·`KAKAO_SEARCH_RADIUS_M`(20000)·`CRAG_MIN_CONFIDENCE`(0.52) 같은 랭킹 상수가 전부 감으로 잡혀 있고, 바꿨을 때 좋아졌는지 나빠졌는지 볼 수단이 없었다. 일정 생성 쪽엔 LLM 하네스(고정 시나리오 20개)가 있는데 검색 쪽엔 대응물이 없다.

## 2. 변경 요약

| # | 변경 | 핵심 |
| --- | --- | --- |
| 1 | 지역 정본 코드 컬럼 `region_code`·`sigungu_code` + btree 인덱스 | ILIKE → 등가 비교. 플래너가 bitmap 으로 먼저 좁히고 정확 KNN |
| 2 | [`region-code.ts`](../../apps/api/src/planner/retrieval/region-code.ts) 정규화 | 적재·질의가 **같은 함수**로 코드를 계산. 라벨 표기가 섞여도 한 코드로 만난다 |
| 3 | 코드 파생은 **주소가 1순위** | KTO 시도 목록에 우리 코드 표에 없는 통합 행정명이 섞여 나온다 (§3.2) |
| 4 | [`eval-retrieval.ts`](../../apps/api/src/scripts/eval-retrieval.ts) 하네스 + 골든셋 10케이스 | recall@k·MRR·지역정합·**적재 커버리지 분리** 측정, 파라미터 스윕 |
| 5 | 전국 재적재 | 경북만 검증돼 있던 카탈로그를 17개 시도로 |

## 3. 상세

### 3.1 지역 코드 pre-filter

정본 코드는 KTO areaCode 같은 숫자가 아니라 **한글 축약 라벨**(`서울`·`경북`·`제주` 17개)이다. 질의 쪽에는 사용자가 친 자유 문자열('경주', '부산 해운대구')밖에 없어서, 외부 조회 없이 양쪽이 같은 값을 계산할 수 있어야 하기 때문이다.

```
적재: 라벨/주소 → placeRegionCodes()  → region_code='경북', sigungu_code='경주'
질의: '경주'    → destinationRegionFilter() → { sido: null, sigungu: '경주' }
                                            → WHERE sigungu_code = '경주'
```

- **시도가 잡히면 시도로만 좁힌다.** '부산 해운대구' 여행이어도 후보 풀은 부산 전역이어야 일정이 짜인다 — 시군구로 좁히면 이동 가능한 인접 후보가 통째로 사라진다.
- **지역 라벨이 아예 없는 행**(`region_code IS NULL AND sigungu_code IS NULL`, 폴백 시드)은 어느 목적지에서도 후보로 남긴다. 기존 `destination_region IS NULL` 레그와 같은 의도.
- **`name/address ILIKE` 레그는 제거.** 그건 지역 컬럼이 못 맞추던 시절의 보정이었고(예: 라벨은 '경상북도'인데 목적지는 '경주'), 이제 `sigungu_code` 가 정면으로 맞춘다.

`EXPLAIN ANALYZE` (로컬 9,761행, 목적지 경북/경주):

| | 계획 | 실행 |
| --- | --- | --- |
| 기존(ILIKE) | **Seq Scan** → Sort | 17.7 ms |
| 신규(코드) | **BitmapOr**(region_code + sigungu_code 인덱스) → Sort | 3.2 ms |

절대값 자체는 아직 작다. 의미는 **계획이 전체 스캔에서 인덱스로 바뀐 것** — 기존 방식은 전국 카탈로그가 커지는 만큼 스캔이 통째로 늘지만, 지금은 그 지역 크기(≈600행)에만 비례한다.

### 3.2 코드 파생은 주소가 1순위

적재 중 KTO `ldongCode2` 가 시도 목록에 **`전남광주통합특별시`** 를 돌려줬다. 우리 코드 표에 없는 통합 행정명이다. 이 라벨로 코드를 정하면 실제로는 광주에 있는 장소가 `전남` 으로 묶여 '광주' 검색에서 통째로 사라진다.

장소의 **주소는 그런 행정 사정과 무관하게 실제 소재지**를 말하므로, `placeRegionCodes(region, sigungu, address)` 는 주소 첫 토큰 → 수집 라벨 순으로 본다. 마이그레이션 백필도 같은 우선순위다.

### 3.3 평가 하네스

`pnpm eval:retrieval` 이 **실제 파이프라인을 그대로 태운다** — pgvector·카카오 폴백·네이버 인지도까지. 골든셋 케이스마다 목적지·취향 태그·트리거를 주고, 취향 벡터는 저장된 임베딩과 같은 방식(`buildPreferenceText` → embed)으로 만들어 개인화 경로까지 실제와 같게 한다.

지표:

| 지표 | 뜻 |
| --- | --- |
| `R@k` | recall@k — 정답 중 상위 k 안에 든 비율 |
| `R\|cat` | **카탈로그에 실제로 있는 정답만으로** 다시 잰 recall. 랭킹 자체의 성적 |
| `cat` | 정답 중 카탈로그에 적재된 비율 — **적재 커버리지** |
| `MRR` | 첫 정답의 역순위 |
| `region` | 결과 중 목적지 지역과 맞는 비율(누수 탐지) |
| `forb` | 나오면 안 되는 장소(타지역 동명 등)가 결과에 든 수 |

**`cat` 을 따로 재는 게 이 하네스의 핵심 설계**다. 이게 없으면 적재를 얕게 한 지역의 낮은 recall 을 랭킹 탓으로 오독한다 — 실제로 첫 측정에서 그 구분이 바로 값을 했다(§5).

스윕은 환경변수를 바꿔가며 같은 골든셋을 반복 측정한다. `ConfigService` 가 `process.env` 를 실시간으로 읽으므로 한 프로세스 안에서 조합을 돌 수 있다.

```bash
pnpm eval:retrieval -- --sweep=PREFERENCE_BLEND_WEIGHT=0,0.3,0.6,1
pnpm eval:retrieval -- --sweep=KAKAO_SEARCH_RADIUS_M=5000,20000 --sweep=CRAG_MIN_CONFIDENCE=0.45,0.52
```

골든셋([`retrieval-golden-set.json`](../../apps/api/src/scripts/retrieval-golden-set.json))의 `relevant` 는 **카탈로그에 있는지와 무관하게** "이 목적지·취향이면 상위에 있어야 마땅한" 장소를 사람이 적는다. 카탈로그에서 뽑아 만들면 커버리지 구멍을 영영 못 본다.

## 4. 스키마 변경

```sql
ALTER TABLE place_embeddings ADD COLUMN region_code  TEXT;  -- 시도 정본 코드 (경북)
ALTER TABLE place_embeddings ADD COLUMN sigungu_code TEXT;  -- 시군구 정본 코드 (경주)
CREATE INDEX idx_place_embeddings_region_code  ON place_embeddings (region_code);
CREATE INDEX idx_place_embeddings_sigungu_code ON place_embeddings (sigungu_code);
```

- 마이그레이션: [`1785400000000-AddPlaceRegionCodes.ts`](../../apps/api/src/database/migrations/1785400000000-AddPlaceRegionCodes.ts) — 컬럼·인덱스 + 기존 행 백필(주소 → 라벨 순).
- `infra/postgres/init.sql` 에도 같은 컬럼·인덱스를 넣었다(로컬 최초 기동용, 두 파일은 같은 내용이어야 한다).
- 백필 SQL 의 별칭 표는 **한 번 쓰고 끝**이다. 새 시도 별칭이 필요해지면 `region-code.ts` 만 고치면 되고(다음 적재에 반영), 이 마이그레이션은 손대지 않는다.

## 5. 검증

### 5.1 전국 재적재

경북만 검증돼 있던 카탈로그를 두 번에 나눠 전국으로 채웠다.

```bash
# 1차 — 모델 정합 재적재(기존 벡터 전량 폐기 후 재생성) + 영업시간 확보
pnpm ingest:places -- --reseed --max=50
# 2차 — 커버리지 확장(영업시간 조회 끔: 장소당 1콜이라 KTO 일일 예산을 통째로 먹는다)
KTO_FETCH_OPENING_HOURS=false pnpm ingest:places -- --max=300
```

| | 결과 |
| --- | --- |
| 1차(reseed) | 16개 시도 1,480건 수집 → 신규 1,437 / 갱신 32, 기존 1,906건 삭제 |
| 2차(확장) | 9,351건 수집 → 신규 8,095 / 갱신 116 / 유지 984 |
| 최종 | **9,761행**, 전 지역 `region_code` 부여 |

- **재적재가 필요했던 이유**: 기존 1,893행이 `embedding_model`·`text_hash` 없이(provenance 이전 적재) 남아 있었다. 어느 모델로 만든 벡터인지 모르는 행이 절반 이상이면 검색 품질을 측정해도 무엇을 측정한 건지 알 수 없다.
- **2차에서 영업시간을 끈 이유**: `detailIntro2` 는 장소당 1콜이라 일일 예산(900)을 300건에 다 쓴다. 게다가 이날 KTO 응답이 느려(10s 타임아웃 다발) 1차 적재 시간의 대부분을 여기서 썼다. 커버리지와 영업시간은 목적이 다르므로 패스를 갈랐다 — 영업시간은 이후 `--max` 작은 증분 실행이 `unchanged` 경로의 backfill 로 채운다.
- 지역별 분포는 시도당 600건 안팎으로 고르다. 예외는 **광주 3건** — KTO 시도 목록이 광주·전남을 `전남광주통합특별시` 로 합쳐 주고, 카카오 앵커가 그 시도의 KTO 좌표에서 파생돼 전남 쪽에 쏠린 결과다(§8 후속).

### 5.2 기준선 측정

```
case                         n    R@5   R@10  R|cat   cat   MRR  region  forb  conf  source
gyeongju-cultural           16   0.20   0.20   0.22   90%  0.50    100%     0  0.72  pgvector
busan-beach                 16   0.10   0.10   0.40   50%  0.50    100%     0  0.70  pgvector
jeju-nature                 16   0.00   0.00   0.00   20%  0.00    100%     0  0.69  pgvector
seoul-city-nightview        16   0.00   0.00   0.25   40%  0.06     94%     0  0.67  pgvector
gangneung-cafe-beach        16   0.10   0.10   0.13   80%  1.00    100%     0  0.65  pgvector
jeonju-food-hanok           16   0.10   0.10   1.00   10%  0.25    100%     0  0.65  pgvector
yeosu-romantic-island       16   0.20   0.20   0.50   40%  1.00    100%     0  0.60  pgvector+kakao+seed
daegu-nostalgic             16   0.00   0.00   0.00   70%  0.00     94%     0  0.64  pgvector
gyeongju-weather-indoor     16   0.14   0.14   0.20   71%  0.50    100%     0  0.74  pgvector
sokcho-mountain             10   0.00   0.00   0.00    0%  0.00    100%     0  0.64  pgvector
----
평균 R@5 0.084 | R@10 0.084 | R|cat 0.270 | 적재 커버리지 47% | MRR 0.381 | 지역정합 99% | 금지어 0
```

읽는 법:

- **지역 필터는 깨끗하다.** 지역정합 99%, 금지어 0 — 타지역 누수가 없다. 코드 pre-filter 가 의도대로 동작한다는 뜻(작업 전 ILIKE 시절엔 `name/address` 부분일치로 타지역 동명 장소가 새는 경로가 열려 있었다).
- **막힌 곳은 랭킹이 아니라 카탈로그다.** 커버리지 47% — 정답의 절반은 아예 적재돼 있지 않다. 남산서울타워·설악산·성산일출봉이 전국 9.7천 건에 없다. KTO `areaBasedList2` 는 인기순 정렬이 없어 페이지를 깊게 파도 대표 명소가 보장되지 않는다.
- **적재된 것 중에서도 27%만 상위에 온다**(`R|cat`). 예: 대구는 '대구 서문시장 & 서문시장 야시장' 이 카탈로그에 **있는데도** 상위 16에 못 든다. 이건 진짜 랭킹 과제다.

**blend weight 스윕** (`--sweep=PREFERENCE_BLEND_WEIGHT=0,0.3,0.6,0.85,1`):

| weight | R@5 | R@10 | R\|cat | MRR | pgvector 단독 |
| --- | --- | --- | --- | --- | --- |
| 0 (순수 취향) | 0.074 | 0.094 | 0.303 | 0.436 | 7/10 |
| 0.3 | 0.084 | 0.084 | 0.284 | 0.377 | 9/10 |
| **0.6 (현재)** | 0.084 | 0.084 | 0.270 | 0.381 | 9/10 |
| 0.85 | 0.084 | 0.094 | 0.281 | 0.381 | 9/10 |
| 1 (순수 질의) | 0.074 | 0.094 | 0.270 | 0.382 | 9/10 |

**결론: 지금 데이터로는 blend weight 를 바꿀 근거가 없다.** 전 구간에서 R\|cat 0.27~0.30, MRR 0.38~0.44 로 케이스 1~2건 차이 안에서만 흔들린다. w=0 이 미세하게 높지만 confidence 가 낮아져 카카오 폴백이 늘고(7/10), 그 이득이 취향 개인화를 버릴 값어치는 아니다. **0.6 유지.** 커버리지를 먼저 올리고 다시 재는 게 순서다 — 정답의 절반이 없는 상태에서 상수를 만지면 노이즈를 쫓게 된다.

반경(`KAKAO_SEARCH_RADIUS_M`) 스윕은 이번엔 의미 있는 신호가 안 나온다 — 10케이스 중 카카오 폴백을 타는 게 1건뿐이라 대부분의 케이스에서 반경이 결과에 관여하지 않는다.

### 5.3 테스트

**마이그레이션** — 두 경로를 다 태웠다.

- 빈 DB 에 `migration:run` → 3건 순서대로 성공(프로덕션 부팅 경로와 동일).
- 적재된 DB 를 복제해 새 컬럼만 떼고 마이그레이션 실행 → 백필 결과가 **로컬 DB 와 행 단위 체크섬 일치**(`md5(id||region_code||sigungu_code)` 9,761행). 손으로 쓴 백필 SQL(정규식 이스케이프 포함)이 적재 경로가 만드는 값과 같은 결과를 낸다는 뜻.

**단위 테스트**

- 신규 [`region-code.spec.ts`](../../apps/api/test/planner/retrieval/region-code.spec.ts) 17케이스 — 표기 정규화(풀네임·단축·로마자), 남북 도 구분, 목적지 → 필터 파생, **주소 우선순위**(`전남광주통합특별시` 라벨을 주소가 이기는지), 폴백 시드가 코드 없이 남는지.
- API 전체 스위트 통과, `tsc --noEmit`·eslint 통과.

## 6. 알려진 한계

- **'광주' 는 못 가른다.** 광주광역시이자 경기 광주시라 질의만으로는 구분 불가 — 광역시로 해석한다(여행 목적지로서의 통상 의미). 경기 광주를 노리면 '경기 광주'로 시도를 붙여야 한다.
- **동명 시군구.** '중구'·'남구'는 시군구 코드가 같다. 시도 코드가 있을 때만 유일해지는데, 검색은 시도가 잡히면 시도로만 좁히므로 실사용에서 충돌하지 않는다.
- **골든셋은 사람이 만든 10케이스**다. 통계적 유의성이 아니라 회귀 감지가 목적 — 상수를 만졌을 때 어느 방향으로 움직이는지 보는 용도다.
- **하네스는 외부 API 를 실제로 호출한다.** 네이버 키가 없으면 인지도 신호가 빠진 상태의 점수가 나온다(같은 조건끼리의 비교는 유효).

## 7. 변경 파일

| 파일 | 변경 |
| --- | --- |
| `planner/retrieval/region-code.ts` | (신규) 시도·시군구 코드 정규화, 목적지 → 필터 파생 |
| `planner/retrieval/place-embedding.repository.ts` | 검색 pre-filter 등가 비교 전환, upsert 시 코드 저장 |
| `database/migrations/…-AddPlaceRegionCodes.ts` | (신규) 컬럼·인덱스·백필 |
| `infra/postgres/init.sql` | 컬럼·인덱스 추가 |
| `scripts/eval-retrieval.ts` | (신규) 평가 하네스 CLI |
| `scripts/retrieval-golden-set.json` | (신규) 골든셋 10케이스 |
| `test/planner/retrieval/region-code.spec.ts` | (신규) 코드 정규화 계약 |
| `apps/api/package.json` | `eval:retrieval` 스크립트 |

## 8. 후속 과제 (미포함)

측정 결과가 가리키는 순서대로.

- ~~**대표 명소 커버리지** (Tier 1)~~ → **해결**. 네이버 추천 글 언급을 발굴해 적재하는 `popular` 소스로 커버리지 47% → 80%. 키워드 시드가 아니라 코퍼스 발굴 + 카카오 정본화 + 역방향 확인 조합으로 갔다 ([popular-place-ingestion](./popular-place-ingestion-v1.md)).
- **광주 커버리지 3건** — 위 작업에서 **진단이 정정됐다**: KTO 라벨만의 문제가 아니라 카카오 주소 정본도 `전남광주통합특별시` 다. 광주 자치구 주소인데 전남으로 분류된 행이 212건. 해결 규칙(통합 라벨에선 시군구 접미사로 시도를 가름)과 백필 범위는 [popular-place-ingestion §8.1](./popular-place-ingestion-v1.md) 참고.
- **시군구 목적지의 경계 명소 누락** — 적재 쪽은 처리됐다(시군구 타깃이 상위 시도 수준으로 검증해 양양 설악산을 속초 패스가 받는다). 남은 건 **검색 쪽** — '속초' 질의가 시군구 코드로 좁히면 양양 설악산이 여전히 후보에서 빠진다. 인접 시군구 확장이나 좌표 반경 보완이 필요하다.
- **랭킹 자체**(`R|cat` 0.27) — 카탈로그에 있는 명소가 상위 16에 못 드는 문제. 지금은 이름·설명 신호가 약한 텍스트 임베딩과 CRAG 가중이 원인 후보. 커버리지 개선 후 재측정하고 나서 손대는 게 맞다.
- **`hnsw.iterative_scan`** — 코드 pre-filter 가 선택적일 때 플래너는 bitmap+정확 KNN 을 고르지만, 카탈로그가 10만 건대로 커지면 HNSW 경로가 다시 선택될 수 있다. 그때는 pgvector 0.8 의 iterative scan(`relaxed_order`)을 세션 GUC 로 켜야 후보 고갈이 안 난다.
- **골든셋 확대** — 지금 10케이스는 회귀 감지용이다. 상수 튜닝을 통계적으로 하려면 30~50케이스가 필요하다.
