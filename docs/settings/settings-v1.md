# TriPick 설정 페이지 v1

문서 목적: 사용자 프로필·알림 카테고리 토글·로그아웃·회원 탈퇴를 한 곳에 모은 `/settings` 페이지 도입 작업을 고정한다. 인박스 v1 위에 얹는 변경이며, 디자인 시스템 · FSD · React Query · NestJS 모듈 경계는 동일한 흐름으로 정리한다.

기준 브랜치: `feat/inbox-setting-page`
작성일: 2026-06-19
선행 문서:
- [`docs/notification/inbox-and-trip-invite-v1.md`](../notification/inbox-and-trip-invite-v1.md)
- [`docs/friends/friends-and-trip-members-v1.md`](../friends/friends-and-trip-members-v1.md)

기준 디자인 시스템: [`docs/design-system/toss-v1.md`](../design-system/toss-v1.md)

## 1. 배경 / 문제

직전 버전까지 사용자 관련 기능은 다음과 같이 흩어져 있었다.

| 항목                    | 상태                                                            | 문제                                                    |
| ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| 닉네임 / 프로필         | `/users/me` API 는 있으나 편집 UI 없음                          | 온보딩 이후 닉네임을 바꿀 수 없음                       |
| 알림 카테고리 on/off    | 모든 카테고리가 항상 인박스에 적재됨                            | 사용자가 끌 수 없음 — 푸시 강제 수신, 인박스 노이즈     |
| 로그아웃                | `/auth/logout` 엔드포인트 있음, 그러나 호출 동선 없음           | 데모 세션이 localStorage 에 영구 남음                   |
| 회원 탈퇴               | 미구현                                                          | 사용자가 데이터를 지울 방법이 없음                      |
| 약관 / 버전 / 라이선스  | 없음                                                            | 스토어 심사·CS 응대용 정적 정보 노출 위치 없음          |

해결 방향:
1. **`/settings` 라우트** 신설 — 프로필 / 알림 / 약관 / 앱 정보 / 계정 5개 섹션으로 일관화.
2. **알림 카테고리 토글** — 백엔드 사용자 엔티티에 `notificationPreferences` jsonb 저장, `InboxService.create()` 단계에서 비활성 카테고리 차단(인박스·푸시 동시 차단).
3. **회원 탈퇴** — `DELETE /users/me` 로 cascade 삭제. 기존 FK 의 `onDelete: 'CASCADE'` 재사용.
4. **하단 네비 4탭 → 5탭** — `홈 / 취향 / 친구 / 알림 / 설정`. 인박스 헤더의 톱니 진입점은 제거.

## 2. 범위

포함:
- 신규 라우트 `/settings`
- 사용자 엔티티 `notificationPreferences` jsonb 컬럼 + default
- 공유 타입 `NotificationPreferencesDto` / `NotificationPreferenceKey` / `DEFAULT_NOTIFICATION_PREFERENCES`
- `PATCH /users/me/notification-preferences` (부분 머지)
- `PATCH /users/me` 의 닉네임 trim / 길이 검증(≤20자, 빈문자 차단)
- `DELETE /users/me` (HttpCode 204, cascade)
- `InboxService.create()` 에서 수신자 preferences 확인 → 비활성 카테고리는 row 미생성 (`null` 반환)
- `weather_alert` 카테고리는 단독 토글을 두지 않고 `replan_ready` 토글에 종속 (`prefersCategory` 내 매핑)
- 프론트 entities/user (`fetchMe` / `updateMe` / `updateNotificationPreferences` / `deleteMe`)
- `logout()` — `/auth/logout` 호출 + `clearSession()` (서버 실패도 로컬은 비움)
- 설정 페이지 5개 섹션 + 회원 탈퇴 확인 다이얼로그
- 하단/사이드 네비 5번째 탭 "설정" + 톱니 SVG 아이콘
- 인박스 헤더에서 톱니 진입점 제거 (모바일·데스크탑 양쪽)

제외 / 후속:
- 약관 / 개인정보처리방침 / 고객센터 / 오픈소스 라이선스 실 페이지 (현재 `#anchor` 스텁)
- 프로필 이미지 업로드 (Object Storage 연동 후)
- 데모 계정 → 카카오 계정 마이그레이션 동선
- `APP_VERSION` 자동 주입 (현재 하드코딩 `'0.1.0'`)
- 탈퇴 사유 수집 / 30일 grace period (soft delete)
- 디바이스별 푸시 토큰 관리 화면

## 3. 데이터 모델

### `UserEntity` 추가 컬럼

```ts
@Column({
  type: 'jsonb',
  default: () => `'${JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES)}'::jsonb`,
})
notificationPreferences: NotificationPreferencesDto;
```

- jsonb 단일 컬럼으로 저장 — 카테고리 추가 시 마이그레이션 불필요, default 만 갱신.
- PostgreSQL 표현식 default 사용 (TypeORM `default: () => ...`) — `synchronize: true` 환경에서 컬럼 추가 시 기존 row 도 즉시 채워짐.

### 공유 타입 (`packages/types/src/user.ts`)

```ts
export type NotificationPreferenceKey = NotificationCategory | 'friend_request';
export type NotificationPreferencesDto = Record<NotificationPreferenceKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesDto = {
  replan_ready: true,
  weather_alert: true,
  trip_reminder: true,
  trip_invite: true,
  general: true,
  friend_request: true,
};

export interface UserDto {
  id: string;
  kakaoId: string;
  nickname: string;
  profileImageUrl?: string;
  email?: string;
  isDemo?: boolean;
  notificationPreferences?: NotificationPreferencesDto;
  createdAt: string;
  updatedAt: string;
}
```

- `NotificationPreferenceKey` 는 인박스의 `NotificationCategory` 5종 + 친구 페이지 가상 row 인 `friend_request` 를 합친 6종.
- `weather_alert` 는 타입에는 남아있으나 UI 상 단독 토글 없음 — 백엔드에서 `replan_ready` 키로 fallback.

## 4. 백엔드 API

### `UsersService` (apps/api/src/users/users.service.ts)

- `update(id, dto)` — `nickname` 이 들어오면 `trim()` 후 빈문자 / 길이 초과(>20자) `BadRequestException`.
- `updateNotificationPreferences(id, partial)` — 기존 값에 default 와 partial 을 머지 후 저장, 머지 결과 반환.
- `prefersCategory(user, key)` — default 머지 후 키 lookup. **`weather_alert` 는 내부적으로 `replan_ready` 키로 치환**.
  ```ts
  const effectiveKey = key === 'weather_alert' ? 'replan_ready' : key;
  return merged[effectiveKey] !== false;
  ```
- `remove(id)` — `repo.remove(user)` 로 cascade 삭제. trips / friends / trip_members / notifications 의 FK 가 이미 `onDelete: 'CASCADE'` 이므로 별도 정리 불필요.

### `UsersController`

| 메서드 | 경로                                  | 설명                                        |
| ------ | ------------------------------------- | ------------------------------------------- |
| PATCH  | `/users/me`                           | 닉네임·프로필이미지 업데이트                |
| PATCH  | `/users/me/notification-preferences`  | 알림 카테고리 부분 업데이트                 |
| DELETE | `/users/me`                           | 회원 탈퇴 (HTTP 204)                         |

전부 `JwtAuthGuard` + `@CurrentUser()` 사용.

### `InboxService.create()` 게이팅

```ts
async create(dto: CreateNotificationDto): Promise<NotificationEntity | null> {
  const receiver = await this.usersService.findById(dto.userId);
  if (receiver && !this.usersService.prefersCategory(receiver, dto.category)) {
    return null; // 알림 생성 자체를 차단 — 푸시·인박스 동시 차단
  }
  return this.notificationsRepo.save(...);
}
```

- 인박스 row 자체를 만들지 않음. 따라서 FCM 푸시(별도 호출) 도 자동으로 차단됨.
- 차단된 알림은 로그·메트릭 없이 조용히 `null` 반환 — 호출자(MainPlannerService / TripsService) 는 반환값을 무시한다.
- `InboxModule` 에서 `UsersModule` import 가 추가됨.

## 5. 프론트 구조 (FSD)

```
src/
├── entities/user/
│   ├── api.ts                           # fetchMe / updateMe / updateNotificationPreferences / deleteMe
│   └── index.ts                         # 재노출 + DEFAULT_NOTIFICATION_PREFERENCES
├── entities/session/api/auth-api.ts     # logout() 추가
├── shared/api/query-keys.ts             # user.me 추가
├── shared/ui/app-frame.tsx              # NAV_ITEMS 4 → 5, grid-cols-4 → 5, 'settings' 아이콘
├── views/settings/ui/settings-view.tsx  # 설정 페이지 본체
├── views/inbox/ui/inbox-view.tsx        # 톱니 진입점 제거
└── app/settings/page.tsx                # 라우트
```

### `/settings` 페이지 섹션 구성

1. **프로필** — 아바타 + 닉네임 인라인 편집 (편집 → input + 저장/취소, `maxLength=20`, 빈값·동일값이면 저장 disable) + 카카오 ID / 이메일 + `isDemo` 칩.
2. **알림 설정** — 5개 토글 (default 모두 on):
   - 여행 초대 (`trip_invite`)
   - 친구 요청 (`friend_request`)
   - 재계획 / 날씨 변동 (`replan_ready` — `weather_alert` 도 함께 제어)
   - 여행 임박 리마인더 (`trip_reminder`)
   - 일반 알림 (`general`)
3. **약관 및 정책** — 이용약관 / 개인정보처리방침 / 고객센터 (`#anchor` 스텁).
4. **앱 정보** — 버전(`'0.1.0'` 하드코딩) / 오픈소스 라이선스 링크.
5. **계정** — 로그아웃(중립 톤) / 회원 탈퇴(빨간 톤 + 확인 다이얼로그).

### React Query 패턴

- `queryKey: queryKeys.user.me`, `staleTime: 60_000`.
- 모든 mutation 이 `onSuccess` 에서 `invalidateQueries({ queryKey: queryKeys.user.me })`.
- 탈퇴 mutation 성공 시 `logout()` → `queryClient.clear()` → `router.replace('/start')` 순서. `clear()` 가 user.me 뿐 아니라 모든 캐시(trips / friends / inbox)를 비워 다음 사용자 세션에 누수 차단.
- 로그아웃 버튼도 동일 흐름(`logout()` + `queryClient.clear()` + `/start` 리다이렉트).

### Switch 컴포넌트 a11y

```tsx
<button
  role="switch"
  aria-checked={checked}
  aria-label={`${label} 알림 ${enabled ? '끄기' : '켜기'}`}
  onClick={() => onChange(!checked)}
/>
```

`role="switch"` + `aria-checked` 로 보조 기술에서 토글 의미 노출, mutation pending 중 `disabled` 로 더블 클릭 차단.

### 회원 탈퇴 확인 다이얼로그

- `fixed inset-0 bg-black/45` 오버레이, 배경 클릭 시 닫기(처리 중엔 무시), 모달 클릭은 stopPropagation.
- 본문: "여행 일정, 친구 목록, 받은 알림이 모두 삭제됩니다. 이 작업은 되돌릴 수 없어요."
- 버튼: 취소(border) + 탈퇴하기(`#F04452` 배경, 처리 중 "처리 중…"으로 라벨 변경).

## 6. 네비게이션 변경

### 5탭화 (`shared/ui/app-frame.tsx`)

```ts
const NAV_ITEMS = [
  { href: '/', label: '홈', icon: 'home' },
  { href: '/preferences', label: '취향', icon: 'preference' },
  { href: '/friends', label: '친구', icon: 'members' },
  { href: '/inbox', label: '알림', icon: 'inbox' },
  { href: '/settings', label: '설정', icon: 'settings' },
] as const;
```

- 하단 네비 `grid-cols-4` → `grid-cols-5`.
- 데스크탑 사이드 네비는 단순 리스트이므로 자동 반영.
- `NavIcon` 에 `'settings'` case 추가 (톱니 SVG).
- `isNavItemActive('/settings', pathname)` 는 정확 일치만 매칭 — 다른 탭들과 동일한 규칙.

### 인박스 진입점 제거

이전 단계에서 인박스 헤더(모바일·데스크탑) 우측에 톱니 진입점을 두었으나, 5탭화로 이동 후 제거. `GearIcon` 함수 자체도 삭제. 미읽음 배지는 그대로 유지.

## 7. 카테고리 토글 / 매핑 규칙

### 매핑

| UI 토글 라벨           | preferences 키    | 영향 범위                                                          |
| ---------------------- | ----------------- | ------------------------------------------------------------------ |
| 여행 초대              | `trip_invite`     | `InboxService.create({ category: 'trip_invite' })`                 |
| 친구 요청              | `friend_request`  | 친구 incoming 가상 row (인박스 직렬화 단계에서 필터)               |
| 재계획 / 날씨 변동     | `replan_ready`    | `replan_ready` + `weather_alert` 양쪽 (백엔드 `effectiveKey` 매핑) |
| 여행 임박 리마인더     | `trip_reminder`   | `InboxService.create({ category: 'trip_reminder' })`               |
| 일반 알림              | `general`         | `InboxService.create({ category: 'general' })`                     |

### `weather_alert` 단독 토글을 두지 않은 이유

- 사용자 관점에서 "재계획" 과 "날씨로 인한 일정 변동" 은 결과적으로 동일한 알림 톤 — 자동으로 일정이 바뀌었음을 알리는 푸시.
- 토글이 갈리면 "재계획은 받고 싶지만 날씨는 받기 싫다" 같은 모호한 조합이 생김.
- 백엔드만 매핑하므로 추후 분리가 필요해지면 `prefersCategory` 의 `effectiveKey` 분기만 제거하고 UI 토글을 한 줄 더 추가하면 됨.

### default 머지 정책

- 사용자가 한 번도 설정하지 않은 경우 `DEFAULT_NOTIFICATION_PREFERENCES` (모두 true) 사용.
- 부분 업데이트 시 `{ ...DEFAULT, ...existing, ...partial }` 순서로 머지 — 새 카테고리를 default 에만 추가해도 기존 사용자에게 자동 적용.

## 8. 회원 탈퇴 cascade 사슬

```
User
 ├─ Trip (owner) ─── TripMember ── Notification (trip_invite, general)
 ├─ TripMember (참여자)
 ├─ Friend (양방향)
 ├─ Notification (수신자)
 ├─ RefreshToken
 └─ FcmToken
```

모든 FK 가 이미 `onDelete: 'CASCADE'` 이므로 `repo.remove(user)` 호출만으로 사슬 전체 삭제. owner 가 탈퇴하면 그 trip 의 다른 참여자 데이터도 함께 사라짐 — 현재는 의도된 동작이며, 후속에서 "owner 위임 후 탈퇴" 같은 동선이 필요할 수 있음.

## 9. 검증

- `pnpm --filter @tripick/types build` ✓
- `pnpm --filter @tripick/api typecheck` ✓
- `pnpm --filter @tripick/web typecheck` ✓

수동 확인 항목:
- 닉네임 편집 → 저장 시 헤더·인박스·친구 목록 표기 갱신
- 토글 off → 해당 카테고리의 새 알림이 인박스에 나타나지 않는지 (예: trip_invite off → 친구가 초대해도 row 미생성)
- 로그아웃 → `/start`, localStorage `tripick.session.v1` 제거 확인
- 회원 탈퇴 → 본인 trip, 친구 관계, 받은 알림 일괄 삭제 확인 (다른 사용자 시점에서 친구 목록·trip 멤버 표기에서 사라짐)
- 하단 네비 5탭 그리드 균등 정렬, 데스크탑 사이드바에 "설정" 노출

## 10. 후속 / backlog

- 약관·개인정보처리방침·고객센터·오픈소스 라이선스 실 페이지
- 프로필 이미지 업로드 (Object Storage 연동 후 PATCH `/users/me`)
- 데모 → 카카오 계정 마이그레이션 동선 (탈퇴 없이 세션 승계)
- `APP_VERSION` 을 `package.json` 에서 자동 주입
- 탈퇴 사유 수집 + 30일 grace period (soft delete `deletedAt`)
- 디바이스별 푸시 토큰 관리 UI (`FcmToken` 목록·해제)
- 알림 카테고리 토글 변경 시 BullMQ 의 예약된 푸시 작업도 함께 취소할지 결정
