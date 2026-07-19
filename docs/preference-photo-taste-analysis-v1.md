# 취향 사진 분석(Vision Taste Tagging) v1

문서 목적: 배관만 있고 실제로는 동작하지 않던 "사진 → 취향 태그" 경로를 로컬 멀티모달 LLM 에 실제로 연결하고, 장당 35초라는 비용에 맞춰 동기 요청에서 BullMQ 잡으로 옮긴 작업을 고정한다.

기준 브랜치: `feat/vision-taste-tagging` (base: `develop`)
관련 문서: [`docs/preferences-enhancements-v1.md`](./preferences-enhancements-v1.md) (사진 업로드·삭제 UI 와 인스타 연동 제거), [`docs/place-embedding-and-preference-personalization-v1.md`](./place-embedding-and-preference-personalization-v1.md) (취향 벡터가 소비되는 곳), [`docs/fcm-production-push-v1.md`](./fcm-production-push-v1.md) (완료 알림이 타는 푸시 경로), [`CLAUDE.md`](../CLAUDE.md) §5 Local LLM, §7 BullMQ 재시도 기본값

## 1. 범위

포함:

- 로컬 Gemma(llama.cpp + mmproj) 에 사진을 실어 취향 태그를 뽑는 경로의 실동작화
- 모델 응답 파싱·검증 (코드펜스·서두 방어, 어휘 밖 태그 제거, confidence 클램프)
- 분석을 BullMQ 잡으로 분리 (업로드 202 + jobId, 진행률 폴링, 완료 푸시)
- 사진 누적 정책: 1회 3장 · 사용자당 총 10장
- `photoTags` 컬럼 — 사진별 분석 결과를 보관해 신규 사진만 분석하고 전체를 재집계
- 분석 실패와 "취향 없음" 구분, 실패 사진의 자동 복구

제외:

- **인스타그램 Graph API** — 사용자가 쓰지 않기로 확정. 직접 업로드만 다룬다
- 이미지 자체의 pgvector 임베딩 — 임베딩은 태그 텍스트 기반이다
- 취향 태그가 임베딩에서 묻히는 문제 — 측정만 하고 후속 브랜치로 넘겼다 (§7)
- 웹 푸시 수신 — 완료 알림은 RN 앱 경로다 (§7)

## 2. 배경 — 배관은 있었고 모델이 없었다

작업 시작 시점에 컨트롤러·스토리지·임베딩·프론트 폼이 모두 있었다. 실제 문제는 세 가지였다.

- `LLM_MODEL=gemma-4` 가 플래너용 텍스트 서버와 같은 값이라, 이미지를 보내도 무시되거나 에러가 났다
- `analyzeImage` 가 모든 예외를 삼키고 빈 태그를 반환해 **실패가 조용히 "취향 없음"으로 끝났다**
- 응답을 `JSON.parse(content) as TasteTagDto` + `as any` 로 그대로 신뢰해, 모델이 `"korean food"`·`"sushi"` 를 뱉으면 그대로 DB 에 들어갔다

`/v1/models` 확인 결과 8080 서버는 `gemma-4-26B-A4B-it-UD-Q4_K_M.gguf` 를 mmproj 와 함께 서빙해 `capabilities: ["completion","multimodal"]` 이 떠 있었다. 별도 서버를 띄우지 않고 같은 서버를 쓰되, 설정만 분리할 수 있게 했다.

## 3. 데이터 흐름

```
[웹] 사진 1~3장 업로드
  → POST /preference-analyzer/upload
      스토리지 저장 → setPhotoUrls(재임베딩 없음) → 잡 등록
      ← 202 { jobId, total, photoUrls }
  → PreferenceAnalyzerProcessor (concurrency 1)
      사진별: storage.getObject → data URL → analyzePhoto
              성공만 photoTags 에 누적, 장마다 updateProgress
      → 기존 photoTags + 이번 결과로 전체 재집계 → upsert(임베딩 갱신)
      → FCM 푸시 (type: general)
[웹] 3초 폴링 GET /preference-analyzer/jobs/:id → 진행률 배너
     완료 시 태그 반영 · 이탈 후 복귀 시 localStorage 의 jobId 로 추적 복원
```

## 4. 설계 판단

### 4.1 동기 요청 → BullMQ 잡

실측이 결정적이었다: **콜드 첫 장 53초, 웜 장당 35초.** 최대 10장이면 순차 350초라 동기 요청으로는 성립하지 않는다. 웹 클라이언트는 타임아웃 설정이 없는 생 `fetch` 이고, 라이브에 nginx 가 붙으면 `proxy_read_timeout` 기본 60초에 잘린다.

`LLM_VISION_TIMEOUT_MS` 기본값 90초는 콜드 53초를 버티기 위한 값이다. 텍스트 플래너(12초) 기준으로 잡으면 첫 업로드가 통째로 실패한다.

### 4.2 워커 concurrency 1

vision 추론이 로컬 llama.cpp **단일 인스턴스**로 가므로 잡을 동시에 돌려도 서버 안에서 다시 직렬화된다. 26B 모델이라 컨텍스트 경합만 커진다. 초기 구현에 있던 `LLM_VISION_CONCURRENCY` 노브는 실제 경로에 영향이 없어 제거했다 — 바꿔도 효과가 없는데 설정으로 문서화돼 있으면 운영 중 오해를 부른다.

### 4.3 잡 페이로드에 이미지 바이트를 싣지 않는다

3장 × 10MB = 30MB 를 Redis 잡 데이터에 넣지 않는다. 스토리지 키만 넘기고 워커가 `storage.getObject` 로 다시 읽는다. 그래서 **업로드에 Object Storage 가 필수**이며, 미설정 시 503 으로 명시적으로 거절한다(조용히 분석만 하고 넘어가지 않는다).

### 4.4 사진은 누적 — `photoTags` 컬럼이 필요한 이유

"1회 3장, 총 10장"은 사진이 **누적**된다는 뜻이다. 그런데 10장 전체 재분석은 350초라 현실적이지 않다.

그래서 사진 URL → `TasteTagDto` 맵을 `preferences.photoTags` 에 보관하고, 새 사진만 분석한 뒤 전체를 재집계한다. 덤으로 **사진을 지워도 그 사진의 취향이 태그에 남던 버그**가 함께 해소됐다 — 삭제 시에도 남은 사진으로 재집계한다.

### 4.5 집계 규칙

여러 장에서 공통으로 나온 태그만 채택한다. 초기 구현의 과반(`ceil(n/2)`) 기준은 10장에서 5장 이상 일치를 요구해 사실상 빈 태그가 나왔다.

| 항목 | 값 | 이유 |
| ---- | -- | ---- |
| 합의 임계값 | 사진 ≤2장이면 1, 그 외 `max(2, ceil(n×0.3))` | 사진이 많을수록 취향이 갈린다 |
| 카테고리당 상한 | 3 | 태그가 많으면 프롬프트 주입 시 신호가 흐려진다 |
| confidence | 태그가 나온 사진들의 평균 | 태그 0개인 결과는 집계·평균에서 제외 |

프롬프트의 "카테고리당 최대 N개"는 상수에서 주입한다. 하드코딩이던 시절엔 상수를 올려도 모델이 따라오지 않았다.

### 4.6 응답 파싱은 방어적으로

llama.cpp 는 `response_format: json_object` 를 줘도 코드펜스나 짧은 서두를 붙일 때가 있다. 첫 `{` 부터 마지막 `}` 까지를 잘라내고, 그래도 깨지면 파싱 실패로 걸러진다. 파싱된 값도 정의된 어휘로 화이트리스트 필터를 거치고(대소문자·공백 정규화 포함), confidence 는 0~1 로 클램프한다.

### 4.7 실패와 "취향 없음"의 구분 — 리뷰에서 교정

초기 구현은 `analyzeImage` 가 모든 예외를 삼켜 빈 태그를 반환했다. 이 구조에서는:

- 잡이 **'성공'으로 끝나** `attempts: 3` 재시도가 가장 흔한 실패(LLM 타임아웃)에서 아예 발동하지 않는다
- 빈 결과가 `photoTags` 에 영구 저장되고, 이후 업로드는 신규 사진만 분석하므로 **그 사진은 영원히 무신호로 남는다**

`analyzePhoto` 가 `{ tags, ok }` 를 반환하도록 바꿨다. 실패는 `photoTags` 에 기록하지 않고 예외를 던져 재시도를 트리거하되, **성공분은 먼저 저장**해 재시도가 남은 사진만 분석하게 했다.

재시도까지 소진된 사진은 여전히 미분석으로 남으므로, **다음 업로드 잡에 함께 싣는다**(`pendingPhotos`). 이게 없으면 "재시도 가능"이 이론에 그친다.

### 4.8 Redis 무응답 대비 — 저장소가 이미 문서화한 함정

`queue.add` 는 Redis 가 죽어 있어도 던지지 않고 ioredis 오프라인 큐에 버퍼링되어 resolve/reject 둘 다 하지 않는다. 그대로 `await` 하면 사진이 이미 저장된 뒤 **업로드 HTTP 요청이 영영 매달린다**.

`WeatherAlertModule` 이 같은 함정을 `withTimeout` 으로 막고 있었으나 private 메서드였다. [`common/with-timeout.ts`](../apps/api/src/common/with-timeout.ts) 로 추출해 양쪽이 공유하고, 잡 등록에 10초 상한을 걸어 초과 시 503 을 반환한다("사진은 저장됐으니 잠시 후 다시 시도해주세요").

### 4.9 진행 상황 전달 — 폴링 + 푸시

취향 페이지는 단발성 온보딩이라 WebSocket 세션을 새로 붙이지 않고 3초 폴링을 쓴다. 페이지를 떠나도 결과를 받도록 완료 시 FCM 푸시를 보낸다.

전용 알림 키를 새로 파면 사용자 알림 설정·DB 기본값·설정 UI 까지 건드려야 해서 기존 `general` 을 쓴다.

폴링 오류 처리는 리뷰에서 교정됐다. 초기 구현은 `retry: false` + 오류 종류 미구분이라 **네트워크 블립 한 번에 `activeJobId` 와 localStorage 를 둘 다 지웠다** — 서버 잡은 도는데 UI 는 진행률을 잃고 새로고침해도 복원되지 않았다. 이제 404(잡 만료)일 때만 추적을 끝내고, 그 외 오류는 3회까지 재시도하며 배너를 유지한다.

### 4.10 업로드 시 재임베딩을 하지 않는다

업로드 시점엔 태그가 아직 안 바뀌었는데 `upsert` 를 타느라 임베딩 서버를 한 번 헛호출하고 있었다. 호출처가 없어 죽어 있던 `setPhotoUrls`(재임베딩 없이 photoUrls 만 저장)가 정확히 이 용도라, 지우는 대신 되살려 썼다. 행이 없으면 생성하도록 보완했다.

## 5. 제한값

| 항목 | 값 | 위치 |
| ---- | -- | ---- |
| 1회 업로드 | 3장 | `MAX_PREFERENCE_UPLOAD` |
| 사용자당 보관 | 10장 | `MAX_PREFERENCE_PHOTOS` |
| 파일 | 10MB, jpeg/png/webp | `ParseFilePipe` |
| vision 타임아웃 | 90초 | `LLM_VISION_TIMEOUT_MS` |
| 잡 등록 타임아웃 | 10초 | `ENQUEUE_TIMEOUT_MS` |
| 폴링 간격 | 3초 | `JOB_POLL_INTERVAL_MS` |

`FilesInterceptor` 한도는 총 보관 수(10)로 두고 1회 한도는 핸들러에서 본다. multer 한도에 걸리면 `"Unexpected field - images"` 라는 원인을 알 수 없는 메시지가 나가기 때문이다.

## 6. 검증

### 실환경 (로컬 Gemma 26B + MinIO + Postgres + Redis)

- **엔드투엔드**: 합성 해변 이미지 → `{"mood":["healing"],"environment":["beach","nature"],"confidence":0.8}`. 업로드 202 → `running`(진행률 0→1→2) → `completed`
- **성능 실측**: 콜드 53초, 웜 장당 35초. 잡 단위로는 1장 50.7초, 2장 97.1초
- **누적**: 기존 1장 + 신규 1장 업로드 시 `total: 1`(신규만 분석), 보관 2장 유지
- **삭제 재집계**: 2장 → 1장 삭제 후 confidence 0.65 → 0.6 으로 재계산
- **분석 실패 경로**: vision 을 죽은 포트로 돌린 뒤 업로드 → 잡이 `failed` 로 떨어지고 `Vision 분석 실패` 로그 3회(재시도 실제 동작), 해당 사진은 `photoTags` **미기록**
- **자동 복구**: vision 복구 후 새 사진 1장 업로드 → `total: 2`(미분석 1 + 신규 1) → 완료 후 4장 전부 기록됨
- **폴링 부하**: 진행 중 응답의 `photoUrls` 가 빈 배열 — DB 조회를 건너뛰는 것 확인
- **제한**: 4장 업로드 시 한국어 메시지로 400

### 단위 테스트

전체 283건 통과, `tsc --noEmit` (api·web) 통과.

주요 계약: 어휘 밖 태그 제거, 코드펜스 응답 파싱, 산문 응답 방어, confidence 클램프, 실패 시 `ok:false`, 실패 사진 미기록, 재시도 시 분석 완료분 스킵, 최종 시도에서만 실패 알림, Redis 무응답 시 503, 총 10장 상한, 1회 3장 상한, 미분석 사진 재큐잉, 잡 소유자 검증, 진행 중 DB 미조회.

## 7. 알려진 한계 / 후속 작업

- **취향 태그가 임베딩에서 묻힌다** — 측정 결과 현실적인 케이스에서 사진 분석의 임베딩 기여도가 **0%** 였다. 취향 어휘 16개 중 13개가 프로필 테마 확장만으로도 나오고, 테마 1개가 7토큰으로 펼쳐지는 반면 사진은 4토큰 수준이라 `new Set()` 중복 제거에서 완전히 사라진다. 후속 브랜치 `feat/preference-embedding-weighting` 에서 가중치·어휘 확장으로 다룬다
- **FCM 실수신 미검증** — Firebase 는 초기화되지만 데모 사용자에 등록된 토큰이 없어 `sendToUser` 가 no-op 로 빠진다. 코드 경로와 호출 인자는 단위 테스트로 덮었으나 실기기 검증은 남아 있다
- **웹은 푸시를 못 받는다** — 완료 알림은 RN 앱 경로다. 웹에서 페이지를 떠나면 복귀 시 폴링 복원으로 결과를 본다. 웹 알림이 필요하면 서비스워커 + web push 를 따로 붙여야 한다
- **미분석 사진의 복구 조건** — 자동 복구는 "다음 업로드"에 편승한다. 사진 10장을 다 채운 상태에서 일부가 미분석이면 사용자가 하나를 지우기 전까지 복구 기회가 없다. 전용 재분석 버튼이 후보
- **confidence 미활용** — 저장만 되고 CRAG 보정이나 임계값 필터에는 쓰이지 않는다
- **`pnpm --filter @tripick/web lint` 는 이 브랜치 이전부터 깨져 있다**(`next lint` 인자 처리). 손대지 않았다

## 8. 변경 파일

```
apps/api/src/preference-analyzer/preference-analysis.service.ts   (신규)
apps/api/src/preference-analyzer/preference-analyzer.processor.ts (신규)
apps/api/src/preference-analyzer/preference-analyzer.constants.ts (신규)
apps/api/src/common/with-timeout.ts                               (신규, weather-alert 에서 추출)
apps/api/src/preference-analyzer/vision.analyzer.ts               (파싱·검증·실패 구분)
apps/api/src/preference-analyzer/preference-analyzer.controller.ts(202+jobId, 제한, 재집계, 재큐잉)
apps/api/src/preference-analyzer/preference-analyzer.module.ts    (큐·알림 모듈 등록)
apps/api/src/preferences/preference.entity.ts                     (photoTags 컬럼)
apps/api/src/preferences/preferences.service.ts                   (photoTags 병합, setPhotoUrls 보완)
apps/api/src/storage/storage.service.ts                           (getObject 추가)
apps/api/src/weather-alert/weather-alert.module.ts                (withTimeout 공용화)
packages/types/src/preference.ts                                  (잡 상태 DTO, 제한 상수)
apps/web/src/entities/preferences/api/preferences-api.ts          (잡 조회, localStorage 복원)
apps/web/src/features/preference-setup/ui/preference-setup-form.tsx(진행률 배너, 폴링)
apps/web/src/shared/api/query-keys.ts                             (analysisJob 키)
apps/api/test/preference-analyzer/*.spec.ts                        (3개 파일)
```

환경변수: `LLM_VISION_TIMEOUT_MS`(90000), `LLM_VISION_TEMPERATURE`(0.1) 추가. `LLM_VISION_BASE_URL`·`LLM_VISION_MODEL` 은 주석 처리 — 미설정 시 `LLM_BASE_URL`·`LLM_MODEL` 로 폴백하므로 같은 서버에 mmproj 가 올라가 있으면 불필요하다.
