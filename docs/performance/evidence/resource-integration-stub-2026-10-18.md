# 자원 배분 정책 통합검증 — 2026-10-18

격리 PostgreSQL과 Redis/BullMQ에서 **22개 통합 테스트가 모두 통과**했다. 최종 실행은 Node.js 24.19.0을 사용했다. 모델 호출은 비동기 스텁이다. 실제 GPU 실행·VRAM·CPU/GPU 분리·추론 지연을 검증한 결과가 아니다.

## 검증 범위

- 동시 사용자 요청 12개 중 미완료 요청 하나만 접수하며, 같은 키 요청 12개는 같은 여행을 반환한다. 다른 입력으로 같은 키를 재사용하면 409로 거부한다.
- 사용자 26명의 동시 접수에서 대기 20개만 허용한다. 대기 취소 후에는 한 자리를 다시 사용할 수 있다.
- 접수 순서대로 Redis에 발행한다. 첫 발행 실패 시 뒤 요청을 앞서 보내지 않는다. DB 접수 후 Redis 장애와 발행 후 DB ACK 유실을 모사하고, 재발행 시 같은 BullMQ job ID로 중복을 막는다.
- 이미 발행을 확인한 대기 job이 Redis에서 유실되면 DB 원장으로 재발행한다. 정상 결과는 한 번만 저장하며, 결과 저장 트랜잭션 실패 시 여행 변경과 실행 완료 전환을 함께 롤백한다.
- Redis 재발행 때 delivery의 `attemptsMade`가 0으로 초기화되어도 DB 원장에 누적한 총 실행 횟수는 3회를 넘지 않는다.
- 실행 중 취소는 늦은 결과 저장을 차단한다. 중복 worker claim은 `reconciling`으로 격리하고 증거를 기록해 해제하기 전까지 다음 실행을 막는다.
- 실행 중 Redis delivery가 유실된 요청은 운영자 전용 `quarantine`으로 격리할 수 있다. version fence로 늦은 저장을 막고, 실행 종료 증거를 기록한 `reconcile` 이후 같은 사용자의 새 요청을 허용한다.
- 같은 자원 키를 공유하는 chat/vision 호출 8개를 서비스 인스턴스 2개에서 보내도 모델 콜백의 최대 동시 실행은 1이다. 별도 자원으로 설정한 embedding은 동시에 실행할 수 있다.
- 모델 슬롯을 기다리던 요청이 취소되면 HTTP 콜백을 시작하지 않는다. 모델 대기열 상한·대기 기한 초과는 기존 실행권을 해제하지 않는다.
- 타임아웃과 proxy 504는 `DRAINING`을 유지한다. 대기 중이거나 새로 들어온 요청은 실행하지 않으며, 구체적인 재시작·완료 확인 증거를 기록한 뒤 해제한다. stale heartbeat는 자동 인계 근거로 사용하지 않는다.
- 자원 해제에는 이전 executor 프로세스 종료 확인과 그 증거도 필요하다. 프로세스 식별 정보가 실행 증거에 남으며, 마지막 실행 guard 이후 DB 소유권이 바뀌면 HTTP dispatch를 거부한다.
- 실제 loopback 포트의 연결 거부는 HTTP 요청이 dispatch되기 전 실패했음을 확인해 자원을 해제한다. timeout·연결 상태 불명과 구분하는 정책을 실제 Axios 오류로 검증했다.
- 신규 migration 2개의 실제 `up/down`, 이전 `generating` 여행이 있는 경우의 설치 거부, 자원당 active owner 하나만 허용하는 unique index를 별도 스키마에서 확인했다.

## 재실행

테스트 전용 PostgreSQL·Redis를 준비하고 저장소 루트에서 실행한다. 아래 주소는 이번 실행에서 사용한 임시 서비스다.

```sh
RESOURCE_TEST_DATABASE_URL=postgresql://resource_test:resource_test@127.0.0.1:54970/resource_test \
RESOURCE_TEST_REDIS_PORT=54848 \
node apps/api/scripts/test-resource-integration.cjs
```

Node.js는 저장소 엔진 조건을 충족하는 24 버전 이상을 사용한다. 최종 검증에 사용한 버전은 24.19.0이다.

테스트는 `resource_policy_integration`과 `resource_policy_migration_integration` 스키마만 생성·삭제한다. Redis에서는 무작위 이름의 전용 BullMQ queue만 삭제한다. 기본 Jest suite는 `.integration-spec.ts` 파일을 수집하지 않으므로 외부 서비스가 필요해지지 않는다.

실행 중 임시 Redis의 RDB 저장이 Docker 디스크 부족으로 실패해 `MISCONF`가 발생했다. 해당 임시 Redis에만 snapshot 저장을 끄고 다시 실행해 통과했다. 이번 검증은 Redis 디스크 영속성이나 프로세스 강제 종료 복구를 증명하지 않는다.

전체 이력 migration, 실제 모델 서버와 이전 executor 프로세스의 중단 확인, 여러 운영체제 프로세스의 강제 종료, 네트워크 단절, 실제 GPU 동시 실행과 성능 수치는 후속 환경 검증 범위다. DB 소유권 재검증은 HTTP 직전의 best effort 확인이므로 해당 확인 후 멈춘 이전 executor를 대신 차단하지 못하며, 운영자의 종료 확인 계약을 검증이 대신하지 않는다. 기계 판독 결과와 검증 소스 해시는 같은 이름의 JSON 파일에 기록했다.
