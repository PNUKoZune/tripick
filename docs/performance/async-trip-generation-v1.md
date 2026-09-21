# 초기 AI 일정 생성 비동기화 v1

## 문제

기존 `POST /main-planner/trips`는 장소 검색, 날씨 조회, LLM 계획, 제약 검증, DB 저장을 모두
요청 안에서 수행했다. 로컬 llama.cpp의 planner timeout만 90초라 브라우저·프록시 타임아웃에
취약했고, 사용자가 보던 세 단계는 서버 상태와 무관하게 2.6초마다 넘어가는 연출이었다.

## 처리 흐름

```text
POST /main-planner/trips
  -> trip(status=generating), trip_days, members 저장
  -> BullMQ trip-generation 큐 등록
  <- 202 Accepted + 생성된 trip summary 즉시 응답

TripGenerationProcessor (concurrency=1)
  -> preparing (15)
  -> discovering_places (35)
  -> building_itinerary (65)
  -> saving (90)
  -> trip.status=confirmed + completed (100)
```

웹은 `GET /trips/:id/generation`을 1초 간격으로 폴링한다. URL에 `generationTripId`를 남기므로
생성 중 새로고침하거나 내 여행 목록으로 나갔다 돌아와도 같은 작업을 이어서 볼 수 있다.

## 실패와 멱등성

- job id는 `trip-generation-{tripId}`로 고정해 같은 trip의 중복 LLM 작업을 막는다.
- 전역 BullMQ 정책에 따라 최대 3회, 2초 고정 backoff로 자동 재시도한다.
- 마지막 시도까지 실패하면 DB 상태를 `generation_failed`로 남긴다.
- `POST /trips/:id/generation/retry`는 owner만 호출할 수 있고, 실패 잡을 제거한 뒤 같은 id로 다시
  등록한다.
- itinerary 저장 뒤 Worker 응답만 실패한 경우 DB의 `confirmed`를 확인해 재생성을 건너뛴다.
- 완료 상태는 DB를 정본으로 사용하므로 Redis의 완료 잡 보관 시간이 지나도 planner로 이동한다.
- 큐 등록 자체가 실패하면 아직 복구 가능한 작업이 없으므로 trip과 연관 데이터를 롤백한다.

## 운영 선택

HTTP를 비동기화하는 것과 GPU 병렬도를 분리했다. chat/vision이 단일 llama.cpp 프로세스를
공유하므로 초기 일정 Worker concurrency는 1이다. 동시 요청은 빠르게 큐에 쌓이지만 26B 모델의
컨텍스트 경합으로 각 작업이 함께 타임아웃 나는 상황은 피한다.

큐 상태 조회·등록에는 10초 상한을 둔다. Redis offline queue가 응답을 무기한 붙잡는 경우 API가
함께 멈추지 않고 503과 복구 UI를 제공한다.
