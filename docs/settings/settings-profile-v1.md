# TriPick 설정 - 프로필 + 페이지 레이아웃 통일 v1

문서 목적: 설정 페이지 안의 **프로필 도메인**(이미지 업로드/복구, 닉네임 인라인 편집, 프로필 hero 카드) 도입과, 그 과정에서 자연스럽게 떠오른 **5개 네비 페이지의 셸/헤더 추상화** 작업을 고정한다. 설정 v1 (`docs/settings/settings-v1.md`) 위에 얹는 변경이며 — 디자인 시스템 · FSD · S3 호환 스토리지 · 화면 매핑 규칙은 동일한 흐름으로 정리한다.

기준 브랜치: `feat/setting-profile`
작성일: 2026-06-23
선행 문서:
- [`docs/settings/settings-v1.md`](./settings-v1.md)
- [`docs/notification/inbox-and-trip-invite-v1.md`](../notification/inbox-and-trip-invite-v1.md)
- [`docs/friends/friends-and-trip-members-v1.md`](../friends/friends-and-trip-members-v1.md)

기준 디자인 시스템: [`docs/design-system/toss-v1.md`](../design-system/toss-v1.md)

## 1. 배경 / 문제

설정 페이지 v1 마무리 직후 남은 불편 + 시각 일관성 문제 두 갈래.

### 1-1. 프로필 도메인의 부재
| 항목 | 직전 상태 | 문제 |
| --- | --- | --- |
| 프로필 이미지 | 카카오 OAuth 가 준 URL 이 fallback. 직접 업로드 동선 없음 | 카카오 외부 URL 의존 + 변경 불가, 데모 계정은 이니셜 아바타 고정 |
| 닉네임 편집 | "편집" 텍스트 버튼 → input 토글 → 저장/취소 버튼 | 클릭 영역과 텍스트 가독성이 분리돼있어 직관성 떨어짐. 모달 같은 무게감 |
| 프로필 섹션 시각 | 기본 카드 안에 작은 14px 아바타 + 한 줄 요약 | PC 에서 hero 부재 → 빈 느낌. 도메인 정보 노출 부족 |
| 이메일/카카오 ID | `email ?? @kakaoId` 중 하나만 표시 | 이메일이 있어도 카카오 ID 한 줄로 가려짐 |

### 1-2. 네비 페이지 셸/헤더가 page 별로 다름
| 페이지 | 셸 | 데스크탑 너비 | 헤더 톤 |
| --- | --- | --- | --- |
| trips | hand-rolled | 1160 | TriPick 28px + 우측 액션 |
| friends | hand-rolled | 960 | TriPick 28px + 설명 |
| inbox | hand-rolled | 960 | TriPick 28px + 설명 |
| settings | hand-rolled | 760 | 20px 단순 제목 |
| preferences | **`AppFrame` + `TopBar` + `PageSection` (옛 추상)** | AppFrame 기본 1180 | 24px + 옅은 라벨 |

해결 방향:
1. **객체 스토리지(MinIO/R2) 기반 프로필 이미지 업로드 + 복구** 도입. `users.profileImageUrl` 컬럼 그대로 활용 — 우리 객체 URL 이면 교체 시 직전 객체 삭제, 카카오 외부 URL 이면 보존.
2. **프로필 액션 시트** — 아바타 클릭 → 시트 → "프로필 사진 변경 / 기본 이미지로 복구" 메뉴. 모바일은 하단 sheet, 데스크탑은 중앙 모달.
3. **닉네임 인라인 편집** — 명시적 "편집" 버튼 폐기. 닉네임 텍스트 자체가 버튼, 옆에 항상 회색 펜 아이콘. Enter/blur 자동 저장, Esc 취소.
4. **프로필 hero 카드** — 그라데이션 + 옅은 블롭 + 80~112px 아바타 + 이메일/카카오ID + 가입일/계정 출처 칩.
5. **새 셸 추상 3종** (`AppFrame` 재작성, `PageHeader`, `PageContainer`) — 5개 nav 페이지 전부 한 패턴으로 통일.

## 2. 범위

포함:
- 객체 스토리지 모듈 (`@aws-sdk/client-s3`) + MinIO `public/profiles/<userId>/<ts>.<ext>` 저장 규칙
- `UsersService.uploadProfileImage` / `removeProfileImage` + `POST/DELETE /users/me/profile-image`
- multipart 파일 업로드 클라이언트 (`api.upload` 헬퍼 신설, `FormData` 일 때 `Content-Type` 자동 설정 스킵)
- 프로필 액션 시트 (`ProfileImageMenu`) — 모바일 bottom sheet / 데스크탑 center modal
- 닉네임 인라인 편집 — 펜 아이콘 상시 노출 + Enter/blur 저장 + Esc 취소
- 프로필 hero 카드 — gradient + 데스크탑 블롭 데코 + `MetaChip` (가입일) + 데모/카카오 칩
- 이메일 + 카카오 ID 둘 다 노출 (이메일 1줄, `@kakao_id` 옅은 회색 2줄)
- `settings-view` FSD 리팩토링: 5개 feature + 1개 widget 으로 분해 (727줄 → 145줄)
- 새 셸 추상 3종 도입 — `AppFrame` (1440 grid + border-x 카드), `PageHeader` (라벨+제목+설명+action), `PageContainer` (1160 inner + responsive padding)
- 옛 `TopBar`, `PageSection` 제거 (사용처 없음)
- 5개 nav view + `trip-create` 모두 새 셸로 마이그레이션
- 데스크탑 컨텐츠 너비 전 페이지 `max-w-[1160px]` 로 통일

제외 / 후속:
- 업로드 이미지 webp 변환 / thumbnail 생성 — 현재는 원본 그대로 저장
- 미로그인 라우팅 미해결 케이스 (RN WebView 에서 `router.replace` silently fail — `feat/inbox-setting-page` 의 backlog)
- 외부 스토리지(Cloudflare R2) 전환 검증 — env `STORAGE_ENDPOINT` 만 바꾸면 동작하도록 추상화는 마쳤으나 라이브 환경 미적용
- 약관/정책/오픈소스 라이선스 실 페이지 (스텁 유지)

## 3. UX 결정 요약

- 닉네임 영역은 **버튼 자체가 텍스트** — 클릭 영역 = 텍스트 영역. 펜 아이콘은 항상 노출(`opacity-0 group-hover:opacity-100` 제거)해 affordance 명시.
- 액션 시트: 시트 안에 안내 1줄 ("JPG, PNG, WebP · 최대 5MB") — 잘못된 파일 선택 자체를 줄임.
- "기본 이미지로 복구" 는 **커스텀 이미지가 있을 때만** 시트에 노출. 이니셜 아바타 상태에선 복구 버튼이 의미 없음.
- 프로필 hero 는 다른 Section 카드와 다르게 그라데이션 + 블롭 — 단 카드 크기·`rounded-[16px]`·border 는 동일하게 맞춰 시각 hierarchy 정렬.
- 모바일 헤더 톤 통일: 20px bold 제목 + 옅은 설명 + 우측 action (이전엔 trips/friends/inbox 28px black 라벨식, settings/preferences 20px 단순식으로 두 갈래였음).
- 데스크탑 헤더 통일: `Tripick · {label}` 12px 파란 라벨 + 22px 제목 + 13px 설명 + 우측 action.
- 컨텐츠 너비 통일: 모든 nav 페이지 `max-w-[1160px]` — 페이지 간 점프 없음.

## 4. 디자인 시스템 추가 매핑

| 토큰 | 사용 위치 |
| --- | --- |
| `bg-gradient-to-br from-[#EAF2FF] via-white to-[#F7F8FA]` | 프로필 hero 카드 배경 |
| `bg-[#3182F6]/8` + `blur-2xl` | 데스크탑 hero 우상단/우하단 블롭 |
| `ring-4 ring-white` | 프로필 아바타 외곽 (그라데이션 위에서 둥글게 떠보이게) |
| `bg-[#FEE500]/40` + `text-[#3C1E1E]` | "카카오 연동" 칩 (카카오 brand 노랑 톤다운) |
| `bg-[#EAF2FF]` + `text-[#3182F6]` | 액션 시트의 "프로필 사진 변경" 아이콘 wrap |
| `bg-[#FFECEE]` + `text-[#F04452]` | 액션 시트의 "기본 이미지로 복구" 아이콘 wrap (destructive) |
| `border border-[#E5E8EB] bg-white/80 backdrop-blur-sm` | `MetaChip` — hero 그라데이션 위에서 옅게 떠보이게 |

추가 비주얼 규칙:
- 모바일 액션 시트는 `items-end + rounded-t-[20px] + pb-[max(12px,env(safe-area-inset-bottom))]`, 데스크탑은 `sm:items-center + sm:rounded-[20px]` 자동 분기.
- 아바타 사이즈는 prop 으로 `md`(56px) / `lg`(80px) / `xl`(80px mobile → 112px lg) 3종 — 설정 hero 는 `xl`.

## 5. FSD 디렉터리 구조 (이 작업 추가/변경 분)

```
apps/web/src/
├── shared/
│   ├── api/client.ts                                # + api.upload(FormData), FormData 일 때 Content-Type 자동 스킵
│   ├── lib/first-error-message.ts                   # 신규 — mutation 에러 배열에서 첫 메시지
│   ├── lib/index.ts                                 # + firstErrorMessage
│   └── ui/
│       ├── app-frame.tsx                            # 재작성 — AppFrame / PageHeader / PageContainer 추가. TopBar / PageSection 제거
│       ├── switch.tsx                               # 신규 — 토글 primitive (role=switch + aria-checked)
│       └── index.ts                                 # + Switch
│
├── entities/
│   └── user/
│       ├── api.ts                                   # + uploadProfileImage / removeProfileImage
│       ├── lib/format-joined.ts                     # 신규 — '2026.06 가입' 포맷
│       ├── ui/user-avatar.tsx                       # 신규 — 순수 표시. md/lg/xl 사이즈
│       └── index.ts                                 # + UserAvatar / formatJoinedSince / 새 api
│
├── features/
│   ├── edit-nickname/                               # 신규
│   ├── manage-profile-image/                        # 신규 — ProfileImageUploader + ProfileImageMenu
│   ├── update-notification-preferences/             # 신규 (기존 settings-view 안 코드 분리)
│   ├── delete-account/                              # 신규
│   └── sign-out/                                    # 신규
│
├── widgets/
│   └── settings-profile-hero/                       # 신규 — ProfileImageUploader + NicknameEditor + 메타 칩 조립
│
└── views/
    ├── settings/ui/settings-view.tsx                # 727줄 → 145줄. 5개 feature + 1개 widget 조립
    ├── preferences/ui/preferences-view.tsx          # AppFrame 패턴으로 마이그레이션 (옛 AppFrame+TopBar+PageSection 폐기)
    ├── friends/ui/friends-view.tsx                  # AppFrame 패턴
    ├── inbox/ui/inbox-view.tsx                      # AppFrame 패턴
    ├── trips/ui/trips-view.tsx                      # AppFrame 패턴 + responsive action slot
    └── trip-create/ui/trip-create-view.tsx          # AppFrame 셸만 사용, 헤더는 뒤로가기 때문에 인라인 유지
```

```
apps/api/src/
├── storage/                                         # 신규 모듈
│   ├── storage.service.ts                           # S3Client (forcePathStyle: true) — putObject / deleteObject / publicUrl / keyFromPublicUrl. env 미설정 시 isReady() false
│   └── storage.module.ts                            # exports StorageService
│
└── users/
    ├── users.module.ts                              # + StorageModule import
    ├── users.service.ts                             # + uploadProfileImage / removeProfileImage. mime/size 검증, 직전 객체 자동 삭제
    └── users.controller.ts                          # + POST /users/me/profile-image (FileInterceptor 5MB), DELETE /users/me/profile-image
```

FSD 원칙 (자세히는 `docs/settings/settings-v1.md` 참고):
- import 방향: `entities → features → widgets → views`
- `entities/user` 는 mutation 없음 — `api.ts` 함수만 export. mutation 은 features 가 소유
- `features/*` 폴더명은 verb-noun (`edit-nickname`, `manage-profile-image`)
- mutation 에러는 각 feature 가 `onError?: (err: Error | null) => void` 콜백으로 위로 전달 → view 가 `firstErrorMessage` 로 통합 표시
- `exactOptionalPropertyTypes: true` 환경에서 optional prop forward 시 spread 패턴: `{...(onError ? { onError } : {})}`

## 6. 타입 정의 (변경 없음)

`UserDto.profileImageUrl?: string` 그대로. 백엔드에서 NULL 로 reset 할 땐 TypeORM `exactOptionalPropertyTypes: true` 우회용 `createQueryBuilder().set({ profileImageUrl: () => 'NULL' })` 사용.

## 7. API 명세

base URL: `http://localhost:4000/api/v1`
인증: `JwtAuthGuard` + `@CurrentUser`

| Method | Path | 응답 | 비고 |
| --- | --- | --- | --- |
| POST | `/users/me/profile-image` | `UserDto` | multipart/form-data, key=`file`. mime: jpg/png/webp, size ≤ 5MB. 우리 객체이면 직전 파일 자동 삭제 |
| DELETE | `/users/me/profile-image` | `UserDto` | 객체 삭제 + `profileImageUrl` NULL |

스토리지 동작:
1. 키 규칙: `public/profiles/<userId>/<timestamp>.<ext>` — MinIO `public/` 프리픽스는 docker-compose 가 익명 다운로드 허용
2. URL: `STORAGE_PUBLIC_URL/<key>` (기본 `http://localhost:9000/tripick/...`, 라이브 환경에선 R2 도메인)
3. **외부 URL (카카오 등) 은 `keyFromPublicUrl` 가드로 삭제 skip** — 잘못 지우지 않음
4. env (`STORAGE_*`) 미설정 시 `StorageService.isReady() === false` → 503 `"스토리지가 설정되지 않았습니다."`

업로드 실패 시 에러 메시지:
- `JPG, PNG, WebP 이미지만 업로드할 수 있어요.`
- `이미지 크기는 5MB 이하만 업로드할 수 있어요.`
- 503: `스토리지가 설정되지 않았습니다.`

## 8. 화면 컴포넌트 매핑

### 8-1. `/settings` 프로필 영역

| 영역 | 컴포넌트 |
| --- | --- |
| Hero 카드 (그라데이션 + 블롭) | [`widgets/settings-profile-hero`](../../apps/web/src/widgets/settings-profile-hero/) |
| 아바타 + 카메라 배지 + 시트 | [`features/manage-profile-image`](../../apps/web/src/features/manage-profile-image/) |
| 인라인 닉네임 편집 | [`features/edit-nickname`](../../apps/web/src/features/edit-nickname/) |
| 메타 칩 (가입일/계정 출처) | hero 안에 인라인 — `MetaChip` 컴포넌트 |
| 아바타 fallback | [`entities/user/ui/user-avatar.tsx`](../../apps/web/src/entities/user/ui/user-avatar.tsx) — md/lg/xl 사이즈 |

### 8-2. 액션 시트

- 트리거: 아바타 클릭 OR 우하단 카메라 배지 클릭 (둘 다 같은 시트 오픈)
- 옵션:
  - **프로필 사진 변경** (📷, 파란 톤) — 항상 표시, 클릭 시 `<input type="file" accept="image/jpeg,image/png,image/webp">` 트리거
  - **기본 이미지로 복구** (🗑, 빨간 톤) — `hasCustomImage === true` 일 때만 표시
  - **취소** (회색, 하단 분리선)
- 배경 클릭 → 닫힘 (처리 중이면 무시), Esc 미지원 (모달 패턴과 일치)
- 같은 파일을 다시 선택할 수 있도록 input value 매번 비움

### 8-3. 셸 추상

| 컴포넌트 | 역할 |
| --- | --- |
| `AppFrame` ([app-frame.tsx](../../apps/web/src/shared/ui/app-frame.tsx)) | 모바일 `max-w-[430px]` 단일 컬럼 + 하단 탭 / 데스크탑 `max-w-[1440px]` 사이드 네비 grid + border-x 카드. `showNav={false}` 옵션으로 nav 제거 (랜딩/콜백) |
| `PageHeader` | `title` (필수, 모바일 20px / 데스크탑 22px), `description?`, `label?` ('Tripick · X' 데스크탑 전용), `action?` (우측 slot) |
| `PageContainer` | `max-w-[1160px]` + responsive padding |

## 9. 사용자 플로우

### 9-1. 프로필 이미지 업로드
1. `/settings` 진입 → 프로필 hero 노출 (이니셜 또는 기존 이미지)
2. 아바타 또는 카메라 배지 클릭 → `ProfileImageMenu` 오픈
3. "프로필 사진 변경" → 파일 피커 → 선택 → `POST /users/me/profile-image` (multipart)
4. 백엔드: mime/size 검증 → 직전 우리 객체 삭제 → 새 객체 업로드 → DB 갱신 → `UserDto` 반환
5. 프론트: `queryKey: user.me` invalidate → hero 가 새 이미지로 즉시 교체
6. 업로드 중엔 아바타 위에 "업로드 중…" 오버레이 + 버튼 disabled

### 9-2. 기본 이미지로 복구
1. 커스텀 이미지가 있을 때만 시트에 "기본 이미지로 복구" 옵션 노출
2. 클릭 → `DELETE /users/me/profile-image`
3. 백엔드: 우리 객체이면 삭제 + `profileImageUrl` NULL
4. 프론트: 이니셜 아바타로 복귀

### 9-3. 닉네임 편집
1. 닉네임 클릭 → 인라인 input 활성화 (autoFocus)
2. Enter → `commit()`: trim 후 빈값/동일값이면 자동 취소, 아니면 mutation
3. blur → 동일하게 `commit()`
4. Esc → 취소 + 원래 값 복원
5. 성공: `queryKey: user.me` invalidate + edit mode 종료

## 10. 검증

```bash
pnpm --filter @tripick/types build
pnpm --filter @tripick/api typecheck
pnpm --filter @tripick/web typecheck
```

수동 검증 절차:
1. `docker compose up -d` 로 MinIO 컨테이너 + 버킷 초기화 컨테이너 둘 다 실행 (`tripick-minio-init` 누락 시 `NoSuchBucket` 에러 — `docker compose up minio-init` 단독 실행으로 복구)
2. 카카오 로그인 또는 데모 세션 → `/settings` 진입
3. 프로필 hero 노출 확인: 아바타·닉네임·이메일/카카오ID·가입일·계정 출처 칩
4. 아바타 클릭 → 액션 시트 → "프로필 사진 변경" → JPG/PNG/WebP 5MB 이하 업로드 → 즉시 hero 갱신
5. 잘못된 파일 (예: PDF, 6MB JPG) 업로드 시 적절한 에러 메시지 (`mutationError` 표시)
6. 시트 → "기본 이미지로 복구" → 이니셜 아바타로 즉시 복귀
7. 닉네임 클릭 → input → Enter/blur 저장 / Esc 취소
8. 5개 nav 페이지 (홈/취향/친구/알림/설정) PC 너비 점프 없음 확인 — 모두 `1160`
9. PC 사이드 네비에서 페이지 전환 시 헤더 톤 일관 확인 — `Tripick · X` 라벨 + 22px 제목 + 부가 설명
10. MinIO 콘솔 (`http://localhost:9001`) 에서 `tripick/public/profiles/<userId>/` 안에 객체 생성 확인. 복구 후 객체 삭제 확인

## 11. 후속 작업 (backlog)

- **이미지 변환 파이프라인** — webp 변환 + thumbnail. 현재는 원본 그대로 저장.
- **외부 URL 보존 정책 명문화** — 카카오 외부 URL 은 그대로 두지만 "기본 이미지로 복구" 시점에 외부 URL 도 비울지 결정 필요
- **App Check / Object lock** — 누구나 `public/profiles/*` 를 다운로드 가능 (의도된 동작이지만 추후 hot-link 방지 검토)
- **RN 모바일에서 프로필 이미지 업로드** — 현재 웹 only. RN 측은 `react-native-image-picker` + WebView 브릿지 통해 `data:` URL 전송하는 동선 별도 설계
- **미로그인 시 `/settings` 자체 가드** — 현재 `TripsView` 에서만 `router.replace('/start')`. 모든 nav 페이지에 공통 가드 필요
- **약관·개인정보처리방침·고객센터·오픈소스 라이선스 실 페이지** (스텁 유지)
- **`Section`/`LinkRow`/`InfoRow` 승격** — settings-view 내 로컬 컴포넌트. 다른 페이지에서도 쓰이면 `shared/ui` 로 이동
- **데스크탑 PC 미로그인 동선** — TripsView (`/`) 의 `router.replace('/start')` 가 RN WebView 에서 silently fail 하는 케이스 조사 (선행 브랜치 backlog)

## 12. 결정 요약

1. 프로필 이미지는 **MinIO `public/` 프리픽스 + S3 호환 SDK** 로 저장 — 라이브 환경에선 `STORAGE_ENDPOINT` 만 R2 로 바꾸면 동작.
2. 우리가 발급한 URL 인지 `keyFromPublicUrl` 로 식별 — 카카오 외부 URL 은 절대 삭제 시도하지 않음.
3. "기본 이미지로 복구" 는 아이콘 텍스트 버튼이 아닌 **액션 시트의 destructive 옵션** 으로 통합 — 메뉴 패턴이 더 명확.
4. 닉네임 편집은 **명시적 버튼 없이 텍스트 자체가 트리거** — Enter/blur 저장 + Esc 취소로 가벼움 유지. 펜 아이콘은 affordance.
5. 프로필 hero 는 다른 Section 카드와 frame 은 같지만 (`rounded-[16px] + border`), 배경만 **그라데이션 + 블롭** 으로 차별화.
6. `settings-view` 727줄 → 145줄. FSD 5 feature + 1 widget 으로 분해 — 다른 페이지 리팩토링의 참조 사례로 [[fsd-conventions-web]] 메모리에 기록.
7. **새 셸 추상 3종 도입** (`AppFrame` 재작성 + `PageHeader` + `PageContainer`) — 5개 nav 페이지 + trip-create 가 동일한 셸·헤더·너비 사용. view 평균 30줄 보일러플레이트 제거.
8. 옛 추상 `TopBar` / `PageSection` 제거 — preferences-view 만 쓰고 있던 상태였고 새 추상으로 대체.
9. 모든 nav 페이지 데스크탑 컨텐츠 너비 `max-w-[1160px]` 로 통일 — 의도된 차이가 어색하다는 사용자 피드백 반영.
