# 실시간 재계획 WebSocket 연동 v1

문서 목적: 끊겨 있던 실시간 재계획(replan) WebSocket 흐름을 FE↔BE로 연결하고, 세션 채널에 인증·인가를 적용한 작업을 고정한다. 소켓 인프라, 구독 훅, 게이트웨이 보안 모델, 공용 Toast 분리를 함께 정리한다.

기준 브랜치: `feat/realtime-websocket-client`
관련 문서: [`docs/main-planner-v1.md`](./main-planner-v1.md) (Screen 3·4, 그동안 mock REST 만 사용), [`docs/email-login-and-session-v1.md`](./email-login-and-session-v1.md) (JWT/세션)

## 1. 범위

포함:

- FE socket.io 클라이언트 인프라 (`/realtime` 네임스페이스, 토큰 핸드셰이크)
- planner 화면에서 여행 세션 구독 → `replan_result` 수신 → react-query 캐시 무효화로 일정 갱신
- 재계획 결과/접근 거부를 노출하는 실시간 토스트
- BE 게이트웨이 **인증**: 핸드셰이크 JWT 검증, 실패 시 연결 차단
- BE 게이트웨이 **인가**: `join-trip` 시 trip 멤버십 확인, 비멤버 차단
- FE ack 콜백으로 `join-denied` 수신 → 사용자 안내
- 공용 `Toast` 컴포넌트 분리 (`shared/ui`)

제외:

- 위치추적 / 여행 진행(트립 프로그레스) 화면 및 `report-deviation` 송신 UI (수신부 인프라만 존재)
- BullMQ replan 워커가 실제로 `pushReplanResult` 를 호출하는지 (별도 점검 필요)
- room 단위를 넘어선 세분화 권한(역할별 채널 등)
- FCM 푸시 / React Native 적용

## 2. 아키텍처 흐름

```
[planner-view] mount
  → useReplanSubscription(tripId)
  → getRealtimeSocket()  (싱글톤, /realtime, auth.token)
  → emit('join-trip', { tripId }, ack)
        └ BE: handleConnection 에서 JWT 검증 (실패 시 disconnect)
        └ BE: canAccessTrip(tripId, userId) 인가 → joined | join-denied
  → on('replan_result')  (멤버일 때만 room 수신)
        └ status==='completed' → invalidateQueries(planner.trip / coordination)
        └ ReplanToast 노출
```

## 3. BE — 게이트웨이 보안 모델

`apps/api/src/realtime/realtime.gateway.ts`

- **인증 (connection 레벨)**: `handleConnection` 에서 핸드셰이크 `auth.token`(없으면 `Authorization` 헤더)을 추출해 `JwtService.verifyAsync` 로 검증한다. 토큰이 없거나 검증 실패하면 `client.disconnect(true)`. 통과하면 payload 를 `client.data.user` 에 저장한다.
- **인가 (message 레벨)**: `join-trip` 핸들러에서 `client.data.user.sub` 로 `TripMembersService.canAccessTrip(tripId, userId)` 를 호출. 권한이 없으면 room 에 join 하지 않고 `{ event: 'join-denied', tripId }` ack 를 돌려준다. → 비멤버는 해당 trip 의 `replan_result` / `deviation` 을 받지 못한다.

`canAccessTrip(tripId, userId)` — `apps/api/src/trip-members/trip-members.service.ts`

- trip owner 거나 `trip_members` 에 `status='accepted'` 멤버면 `true`. 기존 `findAll` 의 접근 검증 로직을 재사용 가능하게 추출했다.

모듈 배선 — `apps/api/src/realtime/realtime.module.ts`

- `JwtModule.registerAsync` (auth 모듈과 동일한 `JWT_SECRET`), `TripMembersModule` import. 순환 의존성 없음(trip-members 는 realtime 을 참조하지 않음).

## 4. FE — 소켓 인프라 / 구독 / 알림

| 파일 | 역할 |
| ---- | ---- |
| `shared/realtime/socket.ts` | `/realtime` 네임스페이스 socket.io 싱글톤. `NEXT_PUBLIC_WS_URL` 사용(미설정 시 `window.location.origin` 폴백), 핸드셰이크마다 최신 액세스 토큰 주입. `disconnectRealtimeSocket()` 제공 |
| `features/subscribe-replan-result/model/use-replan-subscription.ts` | tripId 룸 join(ack 로 `accessDenied` 수신), `replan_result` 수신 시 캐시 무효화, 최근 결과·거부 여부 반환. `active` 플래그로 cleanup 후 늦은 ack 무시 |
| `features/subscribe-replan-result/ui/replan-toast.tsx` | 구독 훅 결과를 공용 `Toast` 로 노출. status→tone/title 매핑, 완료 6초 자동 닫힘, 실패·거부는 수동 |
| `views/planner/ui/planner-view.tsx` | `<ReplanToast tripId={selectedTripId} />` 단일 연결점 |
| `features/sign-out/ui/sign-out-button.tsx` | 로그아웃 시 `disconnectRealtimeSocket()` 호출 |

설계 결정:

- `replan_result.updatedItems` 는 `ItineraryItemDto` 인데 planner 화면은 `PlannerItineraryItemDto` 라 shape 이 다르다. 페이로드를 직접 캐시에 머지하지 않고 **쿼리 무효화로 서버에서 재조회**해 정합성을 서버를 source of truth 로 유지한다.

## 5. 공용 Toast 분리

`shared/ui/toast.tsx`

- 기존엔 공용 토스트가 없어 ReplanToast 내부에 인라인 구현돼 있었다. 이를 `shared/ui` 로 승격.
- tone 네이밍은 `Chip` 과 동일(`neutral | primary | success | warning | error`), 색 팔레트도 Chip 기준.
- fixed 하단 중앙 배치를 포함하고, `onClose` 전달 시 닫기 버튼 노출. 위치는 `className` 으로 override 가능.
- ReplanToast 는 status→tone/title 매핑과 닫힘 로직만 담당하도록 정리. `ReplanStatus` 의 `pending` 누락분도 보강(processing 과 동일 처리).

## 6. 보안 / 남은 작업

- 접근 통제는 2단: **인증**(유효 JWT 없으면 연결 차단) + **인가**(멤버인 trip 룸만 join). 비멤버는 ack 로 `join-denied` 를 받고 FE 가 토스트로 안내.
- 남은 작업:
  - `report-deviation` 을 송신할 위치추적/여행 진행 화면 (현재 수신부만)
  - replan 워커(`alternative.processor`)가 실제로 `pushReplanResult` 를 호출하는지 점검
  - 게이트웨이 인가의 room 재입장/멤버십 변경 시 재검증 정책

## 7. 검증

- `apps/api` · `apps/web` 모두 `pnpm typecheck` 통과, `apps/api` `nest build` 통과.
- 프로젝트 `lint` 스크립트는 ESLint 9 flat config 미마이그레이션으로 레포 전반이 깨져 있음(본 변경과 무관).
