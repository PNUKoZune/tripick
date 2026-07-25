# 회원 탈퇴 사유 수집 · 2단계 확인 v1

문서 목적: 확인 다이얼로그 한 번으로 계정이 사라지던 탈퇴 동선을, **사유 수집 → 확인 문구 입력** 2단계로 바꾸고 삭제 범위를 정직하게 고지하도록 고친 작업을 고정한다. soft delete·30일 grace 를 검토했으나 채택하지 않은 근거도 함께 남긴다.

기준 브랜치: `feat/withdrawal-flow`
작성일: 2026-07-24
선행 문서: [`docs/settings/settings-v1.md`](./settings-v1.md) (설정 페이지 · 기존 `DELETE /users/me`)

커밋: `70ec656`(2단계 플로우) → `f7c505f`(radio·레이아웃) → `94dd41f`(포커스 링) → `64e2c5c`(코드리뷰 반영)

## 1. 범위 · 문제

기존 동선은 설정 → "회원 탈퇴" → 확인 다이얼로그 → 즉시 `DELETE /users/me` 였다. 문제는 둘이다.

1. **오조작 방지 장치가 버튼 한 번**뿐이다. 되돌릴 수 없는 물리 삭제인데 실수로 누른 탈퇴를 막을 게 없다.
2. **떠나는 이유를 아무것도 모른다.** 탈퇴는 서비스 개선 신호가 가장 진한 지점인데 그대로 버려졌다.

백로그의 원안은 "탈퇴 사유 수집 + soft delete(`deletedAt`) + 30일 grace" 였다. 이 중 **사유 수집만 채택하고 soft delete 는 버렸다** — 근거는 6절.

## 2. 구현 파일

| 파일 | 역할 |
| --- | --- |
| [`packages/types/src/user.ts`](../../packages/types/src/user.ts#L48) | `WITHDRAWAL_REASONS`(객관식 7종)·`WITHDRAWAL_CONFIRM_PHRASE`·`WithdrawUserDto` 공유 |
| [`apps/api/src/users/dto/withdraw-user.dto.ts`](../../apps/api/src/users/dto/withdraw-user.dto.ts) | class-validator 요청 바디 (사유 코드 화이트리스트·detail 500자) |
| [`apps/api/src/users/withdrawal-reason.entity.ts`](../../apps/api/src/users/withdrawal-reason.entity.ts) | `withdrawal_reasons` 익명 집계 테이블 |
| [`apps/api/src/users/users.service.ts`](../../apps/api/src/users/users.service.ts#L337) | `withdraw` / `removeUser` / `recordWithdrawalReason` |
| [`apps/api/src/users/users.controller.ts`](../../apps/api/src/users/users.controller.ts#L119) | `POST /users/me/withdrawal` (204) |
| [`apps/web/src/features/delete-account/ui/withdrawal-dialog.tsx`](../../apps/web/src/features/delete-account/ui/withdrawal-dialog.tsx) | 2단계 다이얼로그 |
| [`apps/web/src/features/delete-account/ui/delete-account-button.tsx`](../../apps/web/src/features/delete-account/ui/delete-account-button.tsx) | 진입 버튼 + mutation |
| [`apps/api/test/users/users.e2e-spec.ts`](../../apps/api/test/users/users.e2e-spec.ts) | 탈퇴 e2e 7케이스 |

## 3. API 계약

`DELETE /users/me` 를 **제거하고** `POST /users/me/withdrawal` 로 교체했다. 확인 문구를 검증하려면 바디가 필요한데 DELETE + body 는 클라이언트(`api.delete` 는 body 인자가 없다)와 프록시 양쪽에서 취급이 애매하고, 무엇보다 **확인 없이 삭제되는 경로를 남겨두지 않기 위해서**다.

```
POST /users/me/withdrawal        → 204 No Content
{
  "reason?":       "not_useful" | "bad_recommendation" | "hard_to_use"
                 | "too_many_notifications" | "privacy" | "no_plan" | "other",
  "reasonDetail?": string (≤500),
  "confirmation":  "탈퇴"        // WITHDRAWAL_CONFIRM_PHRASE 와 일치해야 함
}
```

- `confirmation` 불일치 → 400 `탈퇴하려면 "탈퇴"를 입력해주세요.`
- 사유 코드/타입/길이 위반 → 400 (ValidationPipe)
- 사유는 **선택**이다. 건너뛰면 `reason`·`reasonDetail` 없이 `confirmation` 만 온다

**요청 바디는 반드시 class DTO 로 둔다.** 초안은 `packages/types` 의 인터페이스를 `import type` 으로 받았는데, 그러면 `design:paramtypes` 가 `Object` 로 잡혀 전역 ValidationPipe 가 통째로 건너뛴다. `{"confirmation": 5}` 같은 요청이 서비스의 `.trim()` 에서 TypeError → 500 이 됐다(옵셔널 체이닝은 null/undefined 만 막는다). 이 레포의 다른 엔드포인트가 전부 `src/*/dto/*.dto.ts` 클래스를 쓰는 이유이기도 하다.

## 4. 2단계 UI

```
설정 → 회원 탈퇴
  ① 사유 단계   라디오 7종 + 자유입력(500자) + [그만두기] [다음 / 건너뛰고 계속]
  ② 확인 단계   삭제 범위 4항목 고지 + "탈퇴" 입력 → 일치 전까지 버튼 비활성
```

- **사유는 강제하지 않는다.** 미선택이면 버튼 라벨이 "건너뛰고 계속"으로 바뀌어, 사유를 안 남겨도 탈퇴가 막히지 않음을 라벨로 알린다
- ② 단계에서 [이전]으로 ① 로 돌아갈 수 있다. 입력값은 유지된다
- 확인 문구는 `trim()` 후 정확히 일치해야 하고, 서버도 같은 판정을 독립적으로 한다(클라이언트 검증은 UX 용)

**레이아웃**: 카드를 `max-h-[86vh]` flex 컬럼으로 두고 **사유 목록만 스크롤**한다. 자유입력·글자수·버튼은 하단 고정 — 전부를 한 스크롤 영역에 넣었더니 입력란이 경계에 잘려 보였다. ② 단계도 같은 원칙(고지 문구만 스크롤, 확인 입력란·탈퇴 버튼은 항상 노출).

**radio 를 직접 그린 이유**: [`globals.css`](../../apps/web/src/app/globals.css#L72) 가 `input, textarea, select { appearance: none }` 을 전역으로 걸어 네이티브 radio 가 렌더링되지 않는다(`accent-*` 도 네이티브 렌더링 전제라 무의미). 실제 `input[type=radio]` 는 `sr-only` 로 두고 원형 인디케이터를 그린 뒤, 키보드 포커스는 label 의 `focus-within` 링으로 표시한다. 링은 `ring-inset` — 바깥으로 그리면 스크롤 컨테이너 좌우에 잘린다.

## 5. 사유 저장 — 익명 설계

```ts
@Entity('withdrawal_reasons')
class WithdrawalReasonEntity {
  id: string;
  reason?: WithdrawalReasonCode | null;  // 건너뛰면 null
  detail?: string | null;                // 자유입력, 없으면 null
  accountAgeDays: number;                // 가입 후 경과일
  createdAt: Date;
}
```

- **`userId` 를 두지 않는다.** 계정은 물리 삭제되는데 사유 row 에 식별자를 남기면 "지워달라"는 요청의 취지에 어긋난다. FK 도 없으므로 cascade 대상도 아니다
- 해석에 필요한 최소 부가 정보로 `accountAgeDays` 만 남긴다 — "가입 3일 만에 떠남"과 "6개월 쓰고 떠남"은 같은 사유 코드라도 의미가 다르다
- **기록은 삭제가 성공한 뒤에 한다.** 반대 순서면 삭제 실패 시 고아 row 가 남고, 사용자가 재시도할 때마다 익명 row 라 dedup 도 못 해 집계가 부풀어 오른다
- 기록 실패는 `logger.warn` 만 남기고 예외를 삼킨다. 계정은 이미 지워졌으므로 사용자에게 500 을 돌려줄 이유가 없다

## 6. hard delete 유지 결정

soft delete(`deletedAt`) + 30일 grace 를 검토하고 **채택하지 않았다**.

- **보관 의무가 없다.** 결제·거래 이력이 없는 서비스라 법적으로 붙잡아 둘 근거가 없고, 삭제 요청은 즉시 이행하는 게 원칙에 맞다
- **cascade 사슬과 충돌한다.** 여행·친구·인박스·토큰 관계는 전부 hard delete 기준(`CASCADE` / `SET NULL`)으로 짜여 있다. soft 로 바꾸면 "탈퇴자가 멤버인 여행", "탈퇴자가 owner 인 여행"의 표시·권한 규칙을 전부 새로 정하고, 모든 조회 쿼리에 `withDeleted` 누락이 없는지 감사해야 한다. 얻는 것(복구 동선)에 비해 비용이 크다
- **오조작 방지가 grace 의 실질 목적**이라면, 확인 문구 입력이 같은 문제를 훨씬 싸게 푼다

즉 이 작업은 grace 를 **절차(2단계 확인)로 대체**한 것이다.

## 7. 실제로 지워지는 것 / 남는 것

`removeUser` 는 계정 row 삭제 전에 **FK 없이 `userId` 컬럼만 가진 테이블**을 직접 지운다.

| 대상 | 처리 | 근거 |
| --- | --- | --- |
| `fcm_tokens` | 직접 삭제 | FK 없음 — 남으면 orphan row |
| `refresh_tokens` | 직접 삭제 | FK 없음. 남으면 탈퇴 후에도 `/auth/refresh` 가 유저 존재를 확인하지 않고 새 토큰을 계속 발급한다 |
| `email_tokens` | 직접 삭제 | FK 없음 — 삭제된 계정의 인증/재설정 토큰이 잔존 |
| 여행·일정·인박스 등 | FK `CASCADE` | 기존 사슬 그대로 ([settings-v1 §8](./settings-v1.md#L241)) |
| `friends.friendUserId` | `SET NULL` | 상대방 소유 row — 표시 이름·연락처는 남는다 |
| `trip_members.userId` | `SET NULL` | 여행 멤버 구성이 깨지지 않도록 nickname·contact 유지 |

마지막 두 줄 때문에 **UI 고지 문구를 실제 동작에 맞췄다.** 초안은 "친구 목록, 함께하는 여행의 멤버 자격이 모두 삭제됩니다"라고 적었지만, 상대방 친구 목록·공유 여행 멤버 목록에는 지난 표시 이름이 남는다. 그 row 는 상대방 데이터이고 지우면 상대의 여행이 깨지므로, 백엔드가 아니라 **문구를 고치는 게 맞는 해법**이라고 판단했다.

## 8. 검증

- `apps/api` users e2e **21개 통과** (탈퇴 7케이스: 문구 일치/불일치·미지의 사유 코드·비문자열/초과길이 400·익명 저장·사유 건너뛰기·fcm/refresh/email 토큰 정리)
- `apps/api` 유닛 405개 통과, api·web typecheck·lint 통과
- 전체 e2e 중 `trip-members`·`travel-ai-planner` 12건 실패는 이 브랜치와 무관 — 클린 트리(`git stash`)에서도 동일하게 실패한다(`column "opening_hours" does not exist`, 테스트 DB 스키마 동시 생성 충돌)

## 9. 후속 / 제외

- **모달 공통 셸 + 포커스 트랩** — [`shared/ui/dialog.tsx`](../../apps/web/src/shared/ui/dialog.tsx) 와 이 다이얼로그가 스크롤 락·ESC·백드롭을 각자 구현하고, 양쪽 다 포커스 트랩이 없다. 개별 모달에서 고치면 반쪽이라 공통 `ModalShell` 추출 과제로 [백로그](../plans/2026-07-21-open-backlog.md)에 분리
- **DB 마이그레이션** — `withdrawal_reasons` 는 `synchronize` 로 생성된다. 레포 전체가 마이그레이션 없이 굴러가므로 이 테이블만 별도 처리하지 않았다(백로그의 "DB 마이그레이션 인프라" 항목에 포함)
- **탈퇴 사유 조회 화면** — 현재는 DB 직접 조회. 관리자 화면이 생기면 집계 뷰 추가
