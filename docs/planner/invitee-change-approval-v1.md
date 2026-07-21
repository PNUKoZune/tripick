# TriPick 참여자 일정 변경 owner 승인 v1

문서 목적: owner 가 아닌 여행 참여자(companion)의 일정 변경(추가·삭제·수정·순서변경·대안 swap·AI 재계획)을 즉시 반영하지 않고 owner 승인 대기 "제안(ScheduleChangeProposal)" 으로 전환하는 구조를 고정한다. 변경 UI 는 모두에게 노출하되, 비-owner 는 owner 승인(알림 동반) 후에만 실제로 반영된다.

기준 브랜치: `feat/invitee-change-approval`
작성일: 2026-07-21
선행 문서:
- [`docs/notification/inbox-and-trip-invite-v1.md`](../notification/inbox-and-trip-invite-v1.md) (초대 수락/거절 알림 패턴을 승인 흐름으로 복제)
- [`docs/friends/friends-and-trip-members-v1.md`](../friends/friends-and-trip-members-v1.md) (owner=trips.userId / companion 멤버 모델)
- [`docs/planner/alternative-place-picker-v1.md`](./alternative-place-picker-v1.md) (swap · 재계획 진입점)

기준 디자인 시스템: [`docs/design-system/toss-v1.md`](../design-system/toss-v1.md)

## 1. 배경 / 문제

직전까지 일정 변경 5종은 [`MainPlannerService`](../../apps/api/src/main-planner/main-planner.service.ts) 에서 모두 `tripsService.findOne(tripId, user.id)`(owner 전용, 아니면 `ForbiddenException`)로 게이트돼 있었다. 재계획만 `canAccessTrip` 으로 멤버를 허용했다.

- 비-owner 참여자는 planner 에서 편집 UI 를 보긴 해도 조작하면 곧바로 403 을 받았다 — "볼 수는 있는데 만지면 에러" 라 UX 가 깨진다.
- 기존 백로그 항목은 "invitee trip 뷰 owner 전용 UI 숨김(추가/제외/swap)" 이었다. 그러나 참여자가 아예 손대지 못하게 숨기면 협업 여행에서 참여자의 의견이 일정에 반영될 통로가 없다.

해결 방향: **UI 는 owner·참여자 모두에게 노출**하되, 비-owner 의 변경은 즉시 반영하지 않고 **owner 승인 대기 제안**으로 보낸다. owner 는 알림을 받아 변경 내용(diff)을 확인하고 승인/거절한다. 승인 시 **owner 권한으로 기존 서비스 메서드를 그대로 재실행(replay)** 한다.

## 2. 범위

포함(변경 6종이 제안 대상):

- 일정 항목 **추가 / 수정 / 삭제 / 순서변경**(reorder)
- 대안 장소 **swap**(대안 시트 + 지도 검색 장소 반영)
- **AI 재계획**(manual 트리거)
- owner: 승인 요청 알림 + planner diff 미리보기 + 승인/거절
- 참여자: 대기중 내 제안 표시 + 취소, 승인/거절 결과 알림

제외(non-goal):

- owner 본인 변경 흐름은 불변(즉시 반영)
- 승인 정책 커스터마이즈(항목별 권한 위임 등)
- 제안에 대한 코멘트/재협상 스레드

## 3. 핵심 결정

- **범용 제안 모델 1개**: 변경 종류마다 테이블/엔드포인트를 두지 않고 `schedule_change_proposals` 한 곳에 `kind` + jsonb `payload`(원본 요청 그대로) 로 저장한다. 승인 시 kind 로 분기해 기존 메서드를 재실행 → apply 로직 재구현 0.
- **분기 위치는 프론트**: FE 는 이미 `PlannerTripDto.isOwner` 를 갖는다. owner → 기존 엔드포인트 직접 호출, 비-owner → 새 `POST /schedule-changes`. 기존 owner-only 엔드포인트는 그대로 둬 방어선을 유지한다 → 의존성 단방향(ScheduleChange → MainPlanner/Replanning), 순환 없음.
- **승인 replay 는 owner 권한**: `approve` 는 owner `UserEntity` 로 `mainPlannerService.addItem/updateItem/deleteItem/reorderItems/swap` 또는 `replanningService.enqueue` 를 호출한다. 검증·부수효과(이동시간 재계산, 영업시간 경고 등)가 owner 직접 변경과 완전히 동일하다.
- **알림은 초대 패턴 복제**: `trip_invite` 수락/거절과 동형. owner 에게 `schedule_change_request`(확인/거절 액션), 요청자에게 `schedule_change_result`(결과). 처리 시 owner 의 요청 카드는 `cancelScheduleChangeRequest` 로 정리(초대 `cancelTripInvite` 와 동일 접근).

## 4. 데이터 모델 · 타입

`ScheduleChangeProposalEntity` — [`apps/api/src/schedule-change/schedule-change.entity.ts`](../../apps/api/src/schedule-change/schedule-change.entity.ts)

| 컬럼 | 설명 |
| --- | --- |
| `tripId` / `requesterId` | 대상 여행 · 제안한 참여자 |
| `kind` | `add_item`·`update_item`·`delete_item`·`reorder_items`·`swap`·`replan` |
| `payload` (jsonb) | kind 별 원본 요청(discriminated union). 승인 replay 입력 |
| `summary` | 사람이 읽는 한 줄 요약(카드·알림 본문) |
| `status` | `pending`·`approved`·`rejected`·`cancelled`·`failed` |
| `day` / `targetItemId` | 딥링크·미리보기용(있으면) |
| `resolvedAt` | 승인/거절/취소 처리 시각 |

- 테이블은 `synchronize` 로 생성(§7 마이그레이션 인프라는 별개 백로그).
- 공통 타입: [`packages/types/src/schedule-change.ts`](../../packages/types/src/schedule-change.ts) — `ScheduleChangeKind`·`ScheduleChangeStatus`·`ScheduleChangePayload`(union)·`ScheduleChangeProposalDto`·`CreateScheduleChangeDto`.
- 인박스 확장: [`packages/types/src/inbox.ts`](../../packages/types/src/inbox.ts) 에 `NotificationCategory` 2종(`schedule_change_request`·`schedule_change_result`), `InboxItemActionDto.type` 2종(`review-schedule-change`·`reject-schedule-change`) + `proposalId` 필드 추가. preference 기본값 on(설정 UI 미노출 → 항상 켜진 트랜잭션성 알림).

## 5. API 명세

컨트롤러 [`apps/api/src/schedule-change/schedule-change.controller.ts`](../../apps/api/src/schedule-change/schedule-change.controller.ts) · 서비스 [`schedule-change.service.ts`](../../apps/api/src/schedule-change/schedule-change.service.ts). 모두 `JwtAuthGuard`.

| 메서드 | 경로 | 권한 | 동작 |
| --- | --- | --- | --- |
| POST | `/schedule-changes` | accepted 멤버(비-owner) | 제안 생성 + owner 에게 `schedule_change_request` |
| GET | `/schedule-changes?tripId=` | owner·멤버 | owner: 트립 전체 pending / 멤버: 본인 pending |
| GET | `/schedule-changes/:id` | owner·요청자 | diff 미리보기용 단건 |
| POST | `/schedule-changes/:id/approve` | owner | replay + 요청자 결과 알림 + 카드 정리 |
| POST | `/schedule-changes/:id/reject` | owner | 거절 + 결과 알림 + 카드 정리 |
| DELETE | `/schedule-changes/:id` | 요청자 | 취소 + owner 카드 정리 |

동시성·검증 방어(코드리뷰 반영):

- **미지 `kind`**: DTO discriminator 가 못 거른 값은 `propose` 진입부 `KNOWN_KINDS` 화이트리스트로 400 차단(없으면 `locate` 구조분해에서 500).
- **승인/거절/취소 레이스**: `pending → 상태` 를 조건부 `update({id, status:'pending'}, …)` 로 **원자적 선점**. 동시 요청 중 1건만 `affected:1` 로 성공, 나머지는 400 → 중복 반영·중복 알림 방지.
- **replay 실패**: `apply` 가 던지면 `status='failed'` + 요청자에게 실패 알림 + owner 카드 정리 후 400. `apply` switch `default` 로 미지 kind 를 조용한 no-op('승인' 오보고) 대신 실패 경로로 유도.

## 6. FE 구조 (FSD)

- **entities/schedule-change** — [api.ts](../../apps/web/src/entities/schedule-change/api.ts)(6개 호출), [model.ts](../../apps/web/src/entities/schedule-change/model.ts)(`useScheduleChanges`·`useScheduleChange` 쿼리). 쿼리키 `queryKeys.scheduleChanges.*`.
- **변경 훅 비-owner 분기**: 기존 훅에 `isOwner` 주입 → owner 즉시 반영, 아니면 `createScheduleChange`.
  - [`edit-itinerary/model/use-itinerary-items.ts`](../../apps/web/src/features/edit-itinerary/model/use-itinerary-items.ts)(add/update/delete/reorder)
  - [`select-alternative/model/use-alternative-controller.ts`](../../apps/web/src/features/select-alternative/model/use-alternative-controller.ts)(swap)
  - [`apply-searched-place/model/use-apply-searched-place.ts`](../../apps/web/src/features/apply-searched-place/model/use-apply-searched-place.ts)(지도 검색 swap)
  - [`request-replan/model/use-request-replan.ts`](../../apps/web/src/features/request-replan/model/use-request-replan.ts)(replan)
- **features/manage-schedule-changes** — [pending-proposals-panel.tsx](../../apps/web/src/features/manage-schedule-changes/ui/pending-proposals-panel.tsx)(대기 목록: 참여자 취소 / owner 검토), [schedule-change-preview-modal.tsx](../../apps/web/src/features/manage-schedule-changes/ui/schedule-change-preview-modal.tsx)(owner diff before/after + 승인/거절), [use-schedule-change-actions.ts](../../apps/web/src/features/manage-schedule-changes/model/use-schedule-change-actions.ts).
- **planner-view** — 편집 UI 를 owner·참여자 모두에게 노출하고 `isOwner`·`onProposed`(토스트) 전달, 대기 패널 마운트, owner 전용 diff 모달(`?proposalId=` 딥링크). 변경 시 "관리자 승인 후 반영" 배너 + 버튼 라벨을 "변경 요청" 으로 전환.
- **inbox-view** — `schedule_change_request`(확인/거절), `schedule_change_result` 카드 렌더 + 액션. "확인" 은 `/planner?tripId&day&proposalId` 로 이동해 diff 확인 후 승인.

## 7. 사용자 플로우

### 7-1. 참여자 변경 요청

```
참여자가 planner 에서 일정 변경 조작(추가/삭제/…/swap/재계획)
→ POST /schedule-changes (kind + payload)
→ pending 제안 저장 + owner 에게 schedule_change_request(inbox+FCM)
→ 참여자: "변경 요청을 보냈어요" 토스트 + 대기 패널에 표시(취소 가능)
```

### 7-2. owner 승인/거절

```
owner 인박스 schedule_change_request → "확인"
→ /planner?...&proposalId=P → diff 미리보기(before/after)
→ 승인: owner 권한으로 원본 변경 replay → 일정 반영
   거절: 반려
→ 요청자에게 schedule_change_result 결과 알림, owner 요청 카드 정리
```

owner 는 인박스 "거절" 로 즉시 반려하거나, 대기 패널의 "검토" 로도 진입할 수 있다.

## 8. 검증

- API 단위 테스트 — [`test/schedule-change/schedule-change.service.spec.ts`](../../apps/api/test/schedule-change/schedule-change.service.spec.ts): propose 권한·알림·요약, approve kind별 replay 분기, 미지 kind 거절/실패 처리, 승인 실패 폴백, reject/cancel 전이·권한(총 서비스 케이스).
- DTO 검증 — [`test/schedule-change/schedule-change.dto.spec.ts`](../../apps/api/test/schedule-change/schedule-change.dto.spec.ts): kind별 payload union 정상/필수 누락/트리거 오류.
- 타입체크 — API·web `tsc --noEmit` clean.
- FE 는 테스트 러너 미도입(별도 결정) — 이번 범위 테스트는 백엔드 한정.

## 9. 후속 작업 (backlog)

- 새 제안 도착 시 owner 대기 패널 실시간 갱신(현재 inbox WS invalidate 만, 패널은 staleTime 30s·포커스 refetch) — `scheduleChanges.list` 도 WS 로 invalidate.
- trip-progress(Live) 화면 swap 은 라우팅만 제안으로 전환됨 — 대기 패널·결과 토스트 미노출(planner 중심). 필요 시 Live 에도 노출.
- 임계값 없음(제안 만료·수량 제한 등). 대량 제안 시 정책 검토.

## 10. 결정 요약

| 결정 | 이유 |
| --- | --- |
| 범용 제안 테이블 1개 + kind/payload | 변경 6종 apply 로직 재구현 없이 replay. 확장 시 kind 추가만 |
| 분기는 FE, owner-only 엔드포인트 유지 | 의존성 단방향(순환 없음) + 백엔드 방어선 유지 |
| 승인 replay = owner 권한 재호출 | 검증·부수효과가 owner 직접 변경과 동일 |
| 알림은 trip_invite 패턴 복제 | 검증된 accept/decline·카드 정리 흐름 재사용 |
| 상태 전이 원자적 선점 | 동시 승인/취소 레이스로 인한 중복 반영·알림 방지 |
