# 다중 사용자 추론 자원 배분 v1

작성일: 2026-10-18 (Asia/Seoul). 로컬 구현·정책 검증 기록이다. 실제 모델 처리량이나 GPU 장치 예약 성공을 뜻하지 않는다.

## 실행 경계와 적용 범위

초기 여행 생성은 `trip-generation` 큐의 전역 동시 실행을 기본 1개로 제한한다. worker는 `autorun: false`로 등록되고 시작 정책이 Redis의 실제 전역 한도를 확인한 뒤 실행한다. 기존 한도와 설정이 다르면 부팅을 거부한다. 서로 다른 설정의 replica가 기존 한도를 덮어쓰지 않도록 최초 초기화는 BullMQ 5의 `meta.concurrency`에 원자적으로 기록한다. [BullMQ 전역 동시성](https://docs.bullmq.io/guide/queues/global-concurrency)은 같은 큐의 모든 worker에 적용된다.

GPU 호출 전체의 실행권은 별도의 PostgreSQL dispatcher가 소유한다. 큐가 다른 호출과 동기 HTTP 경로도 동일한 `resourceKey`를 사용하면 같은 실행권을 거친다. 현재 조사한 모델 호출자는 다음과 같다.

| 호출자                 | 진입 경로                               | 실행 자원           |
| ---------------------- | --------------------------------------- | ------------------- |
| `PlannerAgentService`  | 초기 생성 worker, 재계획·대안 계획      | chat 키             |
| `VisionAnalyzer`       | 취향 사진 분석 큐                       | 기본 chat과 같은 키 |
| `TextEmbeddingService` | 장소 검색·개인화·색인/재임베딩 스크립트 | embedding 키        |

chat/vision 기본 키는 `llama-cpp:shared`, embedding은 `embedding:default`다. 이름으로 실제 장치를 판정하지 않으며 device 기본값은 `unspecified`다. embedding 서버도 같은 물리 GPU를 점유하면 **같은 resource key**로 설정해야 한다. 다른 프로젝트나 별도 DB의 호출자는 이 실행권에 포함되지 않는다. 이 저장소를 우회하는 직접 HTTP 호출도 제어할 수 없다.

`LLM_CHAT_RESOURCE_KEY`, `LLM_VISION_RESOURCE_KEY`, `LLM_EMBEDDING_RESOURCE_KEY`와 각 `*_RESOURCE_DEVICE=cpu|gpu|external|unspecified`를 실제 토폴로지에 맞춘다. 외부 유료 API는 별도 명시 키와 `external`로 구분한다. 외부 API의 공급자 rate limit을 구현한 것은 아니다. 모든 replica와 실행 스크립트는 같은 DB와 일치하는 키 설정을 사용해야 한다.

## 접수와 결과 정합성

`generation_requests` 한 행이 사용자 admission, 입력 hash/요청 키, 상태, 발행 의도를 함께 소유한다. 여행·일자·동행자·요청 원장은 같은 DB 트랜잭션에서 저장한다. 사용자당 미완료 요청은 1개, 전체 `queued` 상한은 20개다. 트랜잭션 advisory lock과 사용자 미완료 partial unique index로 동시 접수를 제어한다. 순서는 단조 증가하는 admission 번호로 기록한다. 재시도·혼합 길이 작업은 균등한 GPU 사용 시간을 보장하지 않는다.

`Idempotency-Key`를 보내면 같은 사용자·동일 입력의 재요청은 같은 여행을 반환한다. 같은 키에 다른 입력을 보내면 409다. 키를 생략한 호출은 새 요청으로 취급하지만 사용자 미완료 한도는 유지한다. 접수 제한은 429와 `Retry-After: 30`, 신규 접수 중지는 503과 같은 헤더로 응답한다.

DB commit 후 Redis가 실패해도 여행을 삭제하지 않는다. 3초 publisher가 미발행 요청을 순서대로 전달하고, immutable generation ID가 포함된 BullMQ job ID로 중복 발행을 흡수한다. Redis는 실행 전달·진행률 표시를 맡고 DB는 최종 상태를 소유한다.

```text
queued → running → succeeded / failed
queued → cancelled
running → cancel_requested → cancelled
실행 종료 불명확·worker 재전달·전체 기한 초과 → reconciling
```

worker의 claim 버전으로 단계·모델 호출 직전·최종 저장을 확인한다. 최종 itinerary 교체, 원장 성공, 여행 확정은 하나의 트랜잭션이다. 취소·과거 실행 결과는 이 저장 경계를 통과하지 못한다. 실행 중 취소는 HTTP 연결 종료를 강요하지 않고 원격 실행이 돌아오는 동안 사용자 점유를 유지한다. 생성 중 입력 변경·여행 삭제는 실행권과 원장을 우회하지 못하도록 제한한다.

## timeout과 실행권 복구

모델 dispatcher는 자원별 FIFO 대기와 실행 1개를 DB row lock으로 확보한다. 실제 HTTP 요청이 끝난 경우에만 실행권을 반환한다. 네트워크 timeout, 5xx, 종료 여부 불명확은 `DRAINING`, heartbeat가 끊긴 점유는 `RECONCILING`으로 남긴다. 시간 경과·BullMQ stalled slot 반환만으로 다음 모델을 실행하지 않는다. 정상 응답이 나중에 확인되면 그 실행 소유자만 정상 해제할 수 있다.

리다이렉션을 허용하지 않은 모델 요청에서 DNS 실패·접속 거절 등 HTTP dispatch 전 실패가 확인되면 자원을 정상 반환하고 기존 deterministic/hash fallback을 유지한다. 연결 후 단절·timeout과는 구분한다. DB 요청의 최대 실행 시도 3회는 Redis delivery 횟수가 초기화돼도 늘어나지 않는다.

작업 전체 기한은 `TRIP_GENERATION_DEADLINE_MS` 기본 300000ms다. 기한이 지나면 저장 실행권을 차단하고 대조 상태로 바꾼다. `Promise.race`로 백그라운드 연산을 버리고 자원을 반환하지 않는다. 원격 조회·취소 API가 없는 모델 서버에서 강한 무중복 실행을 자동 복구한다고 주장하지 않는다.

운영 절차:

1. 모든 replica에 `TRIP_GENERATION_ADMISSION_ENABLED=false`를 적용해 새 접수·새 재시도를 막는다. 상태 조회·취소와 이미 접수된 요청의 발행/실행은 계속 가능하다.
2. 원장의 generation ID·버전과 `inference_resources`의 active execution ID, `inference_model_executions`의 요청 ID·상태를 대조한다. 정상 실행은 drain을 기다린다.
3. 불명확한 실행은 모델 측 완료 조회 또는 서버 재시작으로 실제 종료를 확인한다. HTTP client timeout만을 근거로 쓰지 않는다. 중단됐던 worker가 뒤늦게 dispatch하지 않도록 **기존 실행 owner 프로세스도 종료했음을 별도로 확인**한다. 실행 evidence의 executor hostname·pid·instanceId와 작업 ID를 사용하고 담당자와 종료/재시작 식별자를 보관한다.
4. 실제 종료 근거를 확인한 후 inference 실행권의 운영 CLI를 사용한다. generation 원장도 `reconciling`이면 별도 CLI로 최종 실패 또는 취소를 기록한다. 두 상태를 모두 확인한 후 접수를 재개한다.

generation 복구 CLI는 앱을 bootstrap하지 않아 worker를 시작하지 않는다. `DATABASE_URL`을 명시해야 하며 자동 DB 기본값이 없다. 예시는 원격 종료 확인을 마친 담당자가 사용하는 형식이다.

```bash
# 먼저 실제 자원 점유 상태 조회. --apply 없는 호출은 읽기 전용이다.
pnpm --filter @tripick/api run ops:reconcile-inference --resource-key=llama-cpp:shared

# worker와 Redis가 함께 유실돼 running으로 남은 원장은 먼저 저장 실행권만 차단한다.
# quarantine는 실행권을 반환하거나 새 모델을 실행하지 않는다.
pnpm --filter @tripick/api run ops:reconcile-generation '<generation-uuid>' quarantine \
  '<operator>' '<lost worker and queue incident reference>'

# 실제 원격 종료 확인 근거를 확보한 뒤에만 실행한다.
pnpm --filter @tripick/api run ops:reconcile-inference --resource-key=llama-cpp:shared \
  --apply --execution-id='<inference-execution-uuid>' --actor='<operator>' \
  --confirmation=model-server-restarted --evidence='<restart id/log reference>' \
  --owner-stopped --owner-stop-evidence='<terminated worker pod uid/process reference>'
pnpm --filter @tripick/api run ops:reconcile-generation '<generation-uuid>' failed \
  '<operator>' '<model restart or remote completion evidence>'
```

큐 삭제·원장 삭제·Redis lease 수동 만료로 복구하지 않는다. 기존 worker로 되돌릴 때도 신규 접수 중지, drain/원격 종료 확인, 최종 DB 상태 대조를 먼저 한다. migration은 기존 `generating` 여행이 남아 있으면 전환을 거부하므로 먼저 기존 작업을 drain해야 한다. 여러 replica에서 동시에 migration을 실행하지 않고 배포 전 단일 migration 단계로 실행한다.

## 계측과 재현

processor는 구조화된 시작·단계·종료 로그에 queue wait, stage elapsed, run time, CPU user/system 시간, RSS를 기록한다. CPU·RSS는 프로세스 수준의 값이므로 같은 프로세스의 다른 요청 영향이 포함된다. GPU 사용률·메모리나 개별 요청 전용 CPU 사용량으로 해석하지 않는다.

정책 부하 시험은 별도 Redis에서 실제 BullMQ worker를 사용하고, 모델 대신 20ms 동일 길이 및 20/80ms 혼합 길이 timer 스텁을 실행했다. 사용자 1·5·20명 × worker 1·2개 × 작업 길이 2종의 **12개 시나리오 모두 최대 실행 1개와 최초 실행 FIFO를 통과**했다. worker 2개는 각 local concurrency를 4로 설정해 전역 한도 적용을 검증했다.

| 사용자 | worker | 동일 길이 대기 p50/p95 (ms) | 혼합 길이 대기 p50/p95 (ms) |
| ------ | ------ | --------------------------- | --------------------------- |
| 1      | 1      | 4 / 4                       | 3 / 3                       |
| 1      | 2      | 3 / 3                       | 2 / 2                       |
| 5      | 1      | 46 / 91                     | 108 / 155                   |
| 5      | 2      | 49 / 93                     | 106 / 149                   |
| 20     | 1      | 203 / 409                   | 397 / 731                   |
| 20     | 2      | 201 / 407                   | 386 / 710                   |

원본 timeline과 실행·CPU·RSS·event loop 지표: [Redis 정책 시험 JSON](./evidence/resource-queue-stub-2026-10-18.json). 이 값은 정책 스텁 결과다. 실제 planner의 1-worker 기준 성능·CPU 전처리 병목을 측정한 값이 아니며 처리량 향상을 뜻하지 않는다. 현 단계에서 CPU worker pool을 추가하지 않았다. 실제 stage/CPU/event loop 측정으로 event loop 점유 병목이 확인되면 별도 bounded process pool로 분리한다. 검색 API 동시성과 CPU 병렬도는 별도로 정한다.

```bash
# isolated local Redis URL을 지정. 임의 UUID 큐만 만들고 정리한다.
RESOURCE_TEST_REDIS_URL=redis://127.0.0.1:<test-port> \
  node apps/api/scripts/resource-queue-load.cjs
```

실제 PostgreSQL·Redis의 정책/장애 통합 검증은 **22/22 통과**했다. 동시 접수·재발행·원자 저장·취소·worker 격리·운영자 종료 증거·DB 재시도 예산과 신규 migration 2개 up/down을 확인했다. 실제 Axios의 닫힌 loopback 포트 접속 거절도 검증했으며, 모델 추론은 스텁이다. [통합 검증 보고서](./evidence/resource-integration-stub-2026-10-18.md)와 [case별 JSON·소스 hash](./evidence/resource-integration-stub-2026-10-18.json)에 범위와 한계를 기록했다.

```bash
# 전용 disposable 서비스만 지정한다. 기본 개발/운영 서비스와 분리한다.
RESOURCE_TEST_DATABASE_URL='postgresql://<test-user>:<test-password>@127.0.0.1:<test-pg-port>/<test-db>' \
RESOURCE_TEST_REDIS_PORT='<test-redis-port>' \
  pnpm --filter @tripick/api run test:resource-integration
```

병행 중인 계획 최적화 변경을 제외한 커밋 스냅샷에서 Node.js 24.19.0으로 API 전체 회귀 1,050개(86개 suite)와 웹 13개가 모두 통과했다. 같은 스냅샷의 API 타입 검사·빌드도 통과했다. 웹 타입 검사, 이번 변경 범위 ESLint, `git diff --check`를 확인했으며 추가 리뷰 수정의 최신 관련 단위 테스트 112개와 통합 22개도 별도로 재확인했다. R06 로컬 manifest/probe 테스트는 12개 통과다.

## 범위별 상태

| 작업 | 이번 결과                                                             | 남은 실제 환경 검증                              |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------ |
| R01  | 모델 호출 경로 조사, 자원 키 설정, 단계·CPU/RSS 계측                  | 실제 하드웨어 조사, 실제 모델 1-worker 기준 성능 |
| R02  | 큐 전역 한도 및 DB 공통 모델 gate                                     | 실제 CPU 병목 측정 후 pool 분리 여부 결정        |
| R03  | 사용자/대기 한도, 요청 키, 순서, API 상태                             | 실제 사용자 부하 분포 측정                       |
| R04  | durable publisher, 취소·버전 저장 경계, 보수적 실행권, 근거 기반 복구 | 실제 모델 timeout·worker 강제 종료 대조          |
| R05  | 정책 시험 timeline, 계측, 접수 플래그, 복구 절차                      | 실제 모델/GPU p50·p95·메모리·성공률              |
| R06  | sw-css에 격리 plugin·경쟁 Pod·read-only probe·복구 절차               | GB10 호환성, 실제 allocatable·GPU 경쟁·CUDA 실행 |

R06의 상세 절차는 별도 저장소 `sw-css/docs/gpu-reservation-validation.md`에 있다. 로컬 장비는 macOS arm64로 GB10·k3s·NVIDIA runtime 검증 환경이 아니므로 실제 예약 성공을 표시하지 않았다.

요청 hash는 접수 DTO의 멱등성에 사용한다. 작업 중 여행 기본 입력과 itinerary 변경은 막지만, 동행자의 초대 수락·거절이나 사용자 취향 프로필 전체를 접수 시점 snapshot으로 고정하지는 않는다. 해당 정보는 worker가 조회한 시점을 따른다. 모든 관련 입력 버전의 snapshot 보장은 잔여 범위다. 수동 itinerary 수정은 경합 방지를 위해 외부 ETA 조회 동안 원장/admission 잠금을 유지하므로, 실제 API 지연 측정 후 조회와 짧은 최종 저장을 분리할 수 있다.
