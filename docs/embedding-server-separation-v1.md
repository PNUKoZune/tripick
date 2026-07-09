# 임베딩 서버 분리 v1

문서 목적: 임베딩 추론을 chat/planner LLM 서버(8080)에서 분리해 전용 임베딩 서버(8081)로 라우팅하고, 차원(1024) 정합·오염 방지 안전장치를 고정한다.

기준 브랜치: `feat/embedding-server-separation` (PR #15 장소·취향 임베딩 파이프라인 위에 스택)
관련 문서: [`docs/place-embedding-and-preference-personalization-v1.md`](./place-embedding-and-preference-personalization-v1.md) (임베딩 소비처: 장소 적재·취향 개인화), [`docs/rag-crag-v1.md`](./rag-crag-v1.md), [`CLAUDE.md`](../CLAUDE.md) 5절 (Local LLM / Triton)

## 1. 배경

임베딩과 chat/planner 추론은 특성이 다르다.

- **chat/planner**: gemma-4 계열 생성 모델, 긴 컨텍스트, 낮은 QPS
- **embedding**: BGE-m3-ko(1024차원) 인코더, 짧은 입력, 적재 시 높은 QPS

기존에는 둘 다 `LLM_BASE_URL`(8080) 하나로 호출했다. 임베딩 전용 서버를 별도 포트(8081)로 띄우면서, 코드가 임베딩만 그쪽으로 보낼 수 있어야 했다.

## 2. 범위

포함:

- 임베딩 호출 엔드포인트를 `LLM_EMBEDDING_BASE_URL`(+`_API_KEY`, `_MODEL`, `_DIMENSIONS`)로 분리, 미설정 시 `LLM_BASE_URL` 폴백(하위호환)
- 임베딩 차원을 1024(BGE-m3-ko)로 통일: `init.sql` 의 `vector(N)`, `LLM_EMBEDDING_DIMENSIONS`, 서비스 기본값
- 헬스체크 preflight 에서 **원격 차원 검증** (엉뚱한 모델 감지 시 중단)
- 서버 미가용 안내 메시지가 임베딩 서버(`LLM_EMBEDDING_BASE_URL`)를 가리키도록 정합

제외:

- 임베딩 서버 배포/서빙 스택 구성(llama.cpp `--embeddings`, TEI/Infinity 등)은 인프라 영역 — 문서 5절에 요건만 명시
- 장소 적재·취향 개인화 로직 자체 (PR #15 범위)

## 3. 호출 경로 분리

```
TextEmbeddingService.tryRemoteEmbedding
  baseUrl = LLM_EMBEDDING_BASE_URL ?? LLM_BASE_URL(폴백)   # 8081 우선, 미설정 시 8080
  apiKey  = LLM_EMBEDDING_API_KEY  ?? LLM_API_KEY(폴백)
  model   = LLM_EMBEDDING_MODEL (기본 text-embedding-model)
  POST {baseUrl}/embeddings  { input, model }
```

임베딩을 쓰는 곳은 공유 [`TextEmbeddingService`](../apps/api/src/embedding/text-embedding.service.ts) 하나로 수렴돼 있어, 여기서만 분기하면 장소 적재·취향 재임베딩·런타임 검색이 전부 8081로 간다.

chat/vision 경로는 그대로 `LLM_BASE_URL`(8080) 사용:

- [`planner-agent.service.ts`](../apps/api/src/planner/agent/planner-agent.service.ts) — 일정 생성 chat completion
- [`vision.analyzer.ts`](../apps/api/src/preference-analyzer/vision.analyzer.ts) — 이미지 취향 분석(멀티모달)

## 4. 오염 방지 안전장치

임베딩 벡터가 조용히 오염되면 pgvector 검색 품질만 나빠지고 에러는 안 나므로(insert 성공) 감지가 어렵다. 두 층으로 막는다.

### 4.1 해시 폴백 감지 (기존, PR #15)

원격 서버 실패 시 `TextEmbeddingService`는 결정적 해시 임베딩으로 폴백한다. `embedWithSource`가 `source: 'remote' | 'hash'`를 반환하고, 적재·재임베딩 preflight(`assertEmbeddingServerReady`)가 `hash`를 감지하면 중단한다(`--allow-hash`로만 강행).

### 4.2 차원 불일치 감지 (이번 작업)

8081에 **차원이 다른 모델**(예: 768차원 ko-sbert)이 실수로 올라가면, `normalizeDimensions`가 조용히 0-패딩/절단해 1024로 맞춰 insert가 성공한다 → 공간 오염.

이를 막기 위해:

- `embedWithSource`가 정규화 **전** 원본 차원을 `remoteDimensions`로 노출
- preflight 에서 `remoteDimensions !== dimensions()`이면 중단
- 이는 해시 폴백이 아니라 **잘못된 모델** 문제이므로 `--allow-hash`와 무관하게 항상 중단

```
assertEmbeddingServerReady:
  probe = embedWithSource('임베딩 서버 헬스체크')
  source == 'remote' && remoteDimensions != expected  → throw (모델/차원 불일치)
  source == 'hash' && !allowHash                        → throw (서버 미가용)
  source == 'hash' && allowHash                         → warn 후 강행
  else                                                  → OK
```

적용 위치: [`place-ingestion.service.ts`](../apps/api/src/planner/retrieval/place-ingestion.service.ts), [`preference-reembed.service.ts`](../apps/api/src/preferences/preference-reembed.service.ts)

## 5. 임베딩 서버 요건

- OpenAI 호환 `/v1/embeddings` 응답 (`{ data: [{ embedding: [...] }] }`)
- 모델 출력 차원 = **1024** (BGE-m3-ko). `init.sql` 의 `vector(1024)`·`LLM_EMBEDDING_DIMENSIONS`와 반드시 일치
- llama.cpp 로 서빙 시 `--embeddings` 플래그 필수 (없으면 501)
- `LLM_EMBEDDING_MODEL` 은 서빙 스택에 등록된 모델명과 일치

## 6. 환경변수

```dotenv
# chat/planner (8080)
LLM_BASE_URL=http://localhost:8080/v1
LLM_MODEL=gemma-4

# embedding (8081) — 미설정 시 LLM_BASE_URL 폴백
LLM_EMBEDDING_BASE_URL=http://localhost:8081/v1
# LLM_EMBEDDING_API_KEY=local   # 키가 다를 때만
LLM_EMBEDDING_MODEL=dragonkue/BGE-m3-ko
LLM_EMBEDDING_DIMENSIONS=1024   # init.sql vector(N)과 동일해야 함
```

## 7. 마이그레이션 주의

차원을 1536 → 1024로 바꿨다. `init.sql`은 **빈 볼륨에서만** 실행되고 `CREATE TABLE IF NOT EXISTS`는 기존 컬럼 차원을 바꾸지 않는다. 기존 로컬 볼륨이 있으면 재초기화 필요:

```bash
docker compose down -v          # 볼륨 삭제 (pgvector 데이터 전부 소실)
docker compose up -d            # init.sql 재실행 → vector(1024)
pnpm --filter @tripick/api ingest:places -- --regions=서울,부산 --reseed
pnpm --filter @tripick/api reembed:preferences   # 기존 취향 있으면
```

## 8. 검증

- `tsc --noEmit` (api) 통과
- [`text-embedding.service.spec.ts`](../apps/api/test/embedding/text-embedding.service.spec.ts): 엔드포인트 라우팅(8081 우선 / 8080 폴백), `source` 판정, `remoteDimensions` 노출
- 로컬 수동: 8080 gemma-4 chat + 8081 BGE-m3-ko 동시 기동, `/v1/embeddings` 1024차원·L2 norm≈1.0, 의미 유사도 sanity(cos(카페,커피숍) > cos(카페,등산)) 확인
