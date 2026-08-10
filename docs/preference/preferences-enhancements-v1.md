# 취향 페이지 개편(Preferences Enhancements) v1

문서 목적: 취향 설정 페이지(`/preferences`)를 "몇 개의 프리셋 태그를 고르는 폼"에서 **테마 선호/불호 + 사진 기반 취향 분석**까지 다루는 화면으로 개편한 작업을 고정한다. 온보딩 유도 흐름 변경, 관심 테마 구조 개편(선호/불호), 인스타그램 연동 제거 → 사진 직접 업로드·분석·저장·삭제, 레이아웃·UX 개선(시각 피커·2열 배치·토스트·이탈 경고·기본값 되돌리기), 공용 `ConfirmDialog` 분리, 관련 버그 수정을 정리한다.

기준 브랜치: `feat/preferences-enhancements`
작성일: 2026-07-13
관련 문서: [`docs/preference/place-embedding-and-preference-personalization-v1.md`](./place-embedding-and-preference-personalization-v1.md) (취향 벡터 개인화 검색), [`docs/planner/rag-crag-v1.md`](../planner/rag-crag-v1.md) (CRAG 검색), [`docs/settings/settings-profile-v1.md`](../settings/settings-profile-v1.md) (프로필 이미지 Object Storage 업로드 패턴), [`docs/trips/trip-create-v1.md`](../trips/trip-create-v1.md) (MUI 시계 피커 원본)

## 1. 범위

포함:

- **온보딩 유도 흐름 변경**: 로그인 직후 강제로 `/preferences`로 보내던 "별도 화면"을 없애고, 첫 로그인(취향 미설정) 시 **홈에서 유도 시트**로 안내
- **관심 테마 구조 개편**: 여행 스타일·동행 섹션 제거, 관심 테마를 **6개 대분류 × 22개 세부 테마**로 확장하고 각 테마를 **선호/불호(기본 중립)** 로 선택 (공통 타입·백엔드 임베딩·테스트까지 풀스택)
- **인스타그램 연동 제거 → 사진 직접 입력**: 비즈니스/크리에이터 계정 제약으로 피드 연동이 불가 → 가짜 인스타 토글/프리셋 태그를 제거하고 **사용자 사진 업로드 → vision 분석 → 취향 태그** 흐름으로 전환
- **사진 원본 Object Storage 저장 + 개별 삭제**: 분석만 하고 버리던 원본을 스토리지에 보관, "저장된 사진" 갤러리·개별 삭제 지원
- **시각 피커·레이아웃·UX**: 취침/기상 MUI 시계 피커(soft variant), 하위 섹션 PC 2열 배치, 저장 성공 토스트, 저장 버튼 anchor, 로딩 스켈레톤, 페이지 이탈 경고, 기본값 되돌리기
- **공용 `ConfirmDialog`** 분리(중앙 확인 다이얼로그)
- 웹(Next.js) UI + `preferences`/`preference-analyzer` 백엔드 + 공통 타입 + 유닛/e2e 테스트

제외:

- 인스타그램 Graph API 실연동 (앱 검수 리스크로 직접 업로드 우선 — CLAUDE.md 방침 유지)
- 앱 내부 소프트 네비게이션 이탈 차단 (App Router 공식 API 부재 → `beforeunload` 브라우저 레벨만)
- 취향 사진 원본 표시 외 리사이즈·썸네일 생성, EXIF 제거 (후속)

## 2. 온보딩 유도 흐름 (`features/prompt-preference-setup`)

- 기존: 카카오/데모 로그인 → `router.replace('/preferences')`로 취향 폼(하단 네비 포함)에 강제 진입. 이메일 로그인은 취향을 아예 안 거침.
- 변경: **모든 로그인이 홈(`/`)으로 진입**하고, 홈에서 취향 미설정을 감지하면 유도 시트를 띄운다.
  - `PreferenceSetupPrompt`: `getMyPreferences()`가 `profile` 없음이면 `BottomSheet`로 "취향부터 설정해 볼까요?" 안내 + CTA(→ `/preferences`) / "나중에 하기"
  - "나중에"는 `sessionStorage`(`tripick.pref-prompt-dismissed`)로 이번 세션 재노출 차단. 취향 저장 시 `profile`이 채워져 자연히 미노출
  - `views/trips/ui/trips-view.tsx`에 마운트, 강제 리다이렉트 제거(`kakao-callback-view`, `auth-start-actions` → `/`)
- **취향 저장 후 `/friends` 이동 제거**: 저장은 페이지에 머무르며 완료 토스트만. 이 과정에서 미사용이 된 `ensureActiveTrip` 체인(`entities/trip/api/trip-api.ts`, `entities/trip/model/active-trip-storage.ts`)과 `queryKeys.trips.active`를 정리

## 3. 관심 테마 — 대분류·선호/불호 (풀스택)

### 데이터 모델 (`packages/types/src/preference.ts`)

- 제거: `TravelStylePreference`, `CompanionPreference`, `InterestPreference`
- 신설: `ThemePreference` — 22개 세부 테마 (자연·풍경 / 예술·문화 / 미식 / 액티비티·체험 / 쇼핑·거리 / 뷰·감성)
- `PreferenceProfileDto`: `travelStyles`·`companions`·`interests` 제거 → `likedThemes`·`dislikedThemes` 두 배열로 저장(중립은 미저장)

### 프론트엔드

- `entities/preferences/model/options.ts`: `THEME_GROUPS`(대분류 → 세부 테마 `{value,label,examples,taste}`) + `THEME_TO_TASTE`, `TASTE_TAG_LABELS`(영문 enum → 한국어)
- `features/preference-setup/ui/preference-setup-form.tsx`: 그룹별 세부 테마를 **선호/불호 토글**(기본 중립, `react-icons` 엄지)로 선택, PC 2열 그리드
- **취향 태그 한국어 표시**: `widgets/trip-info-panel`이 tasteTags(영문 enum)를 `TASTE_TAG_LABELS`로 매핑해 노출

### 백엔드

- `preference-text.ts`: 옛 STYLE/INTEREST 어휘 제거 → `THEME_TAGS`(영문 place-tag, 해시 폴백 정합) + `THEME_KEYWORDS`(한국어)로 임베딩 텍스트 생성. **선호 테마만** 양의 신호, 불호는 제외
- `preferences.service.ts`: `DEFAULT_PROFILE`·병합 로직을 신규 필드로 교체
- 테스트: `preference-text.spec.ts`, `travel-ai-planner.e2e-spec.ts` 갱신

> 참고: `tasteTags`(food·mood·environment)는 이제 **사진 분석에서만** 채워진다(§4). 테마 신호는 `profile.likedThemes`가 `buildPreferenceText`에서 임베딩 텍스트로 반영되므로, 저장 시 FE에서 테마 기반 tasteTags를 파생·전송하지 않는다. 그래서 `THEME_TO_TASTE`(FE)는 현재 미사용 상태이나, 향후 taste 기반 필터/CRAG용 도메인 데이터로 남겨둔다.

## 4. 사진 취향 분석 — 업로드·분석·저장·삭제

### 흐름

```
사진 선택/드래그 → POST /preference-analyzer/upload (multipart 'images', 최대 10)
→ base64 data URL 로 vision 분석(오프라인 대응) → tasteTags 추출
→ (스토리지 설정 시) 원본을 Object Storage 에 보관
→ upsert(tasteTags[, photoUrls]) → { tasteTags, photoUrls, embeddingId, preferenceId }
```

### 백엔드

- `preference-analyzer.controller.ts`
  - 분석은 base64 data URL 로 수행(LLM 서버가 URL fetch 불가한 로컬 환경 대응)
  - **원본 저장**: `StorageService.putObject`로 `public/preferences/<userId>/<ts>-<i>.<ext>` 저장, 반환 URL을 preference에 기록. 새 업로드가 기존을 교체하면 이전 오브젝트 정리(`keyFromPublicUrl` → `deleteObject`)
  - **개별 삭제**: `DELETE /preference-analyzer/photos?url=` — 본인 `photoUrls`에 있는 URL만 스토리지 원본+목록에서 제거(임의 오브젝트 삭제 방지)
  - `PreferenceAnalyzerModule`에 `StorageModule` 연결
- `preference.entity.ts`: `photoUrls: string[]`(jsonb, default `[]`)
- `preferences.service.ts`: `upsert`가 `photoUrls` 지정 시 교체(미지정 시 유지), `setPhotoUrls`(임베딩 영향 없어 경량 갱신)
- 공통 타입: `PreferenceDto.photoUrls?`, `UpdatePreferenceDto.photoUrls?`
- **graceful**: `STORAGE_*` 미설정이면 원본 저장은 건너뛰고 분석은 정상 동작

### 프론트엔드

- `preferences-api.ts`: `analyzePreferenceImages`(`api.upload`), `deletePreferencePhoto`(`api.delete` + query url). `savePreferences`는 **profile만** 전송해 사진 분석 tasteTags를 덮어쓰지 않음
- 폼: 사진 선택(파일 피커 + **드래그앤드롭**), 미리보기·제거, "사진 N장으로 취향 분석하기", 분석된 태그(한국어) 표시, **"저장된 사진" 갤러리 + 개별 삭제(X)**
- 검증: `accept="image/jpeg,image/png,image/webp"` + FE 형식·용량(10MB) 사전 검증(백엔드 제약 정합), 미분석 사진이 있으면 저장 차단 안내

## 5. 시각 피커 · 레이아웃 · UX

- **MUI 시계 피커**: `views/trip-create/ui/time-field.tsx`를 `shared/ui/time-field.tsx`로 이동해 여행 생성·취향 설정에서 공유. `variant`(`outlined` 기본 / `soft` 취향용 soft-bg 박스)
- **하위 섹션 PC 2열 배치**: 취침/기상·이동수단·페이스·강도·분위기·사진 섹션을 `lg:grid-cols-2`로 묶고 너비 제한 제거
- **저장 성공 토스트**: 하단 InlineNotice → `Toast`(자동 닫힘). 에러는 인라인 유지
- **저장 버튼 anchor**: 2열 그리드 아래 왼쪽에 떠 보이던 버튼을 전체 폭 구분선 + `lg:mx-auto` 중앙 정렬로 배치. "기본값 되돌리기" 보조 버튼 추가
- **로딩 스켈레톤**: `preferenceQuery.isLoading` 동안 기본값 깜빡임 제거
- **페이지 이탈 경고**: 저장 안 된 변경(폼 편집 or 미분석 사진)이 있으면 `beforeunload` 경고. 분석된 사진은 서버 반영이라 제외
- **기본값 되돌리기**: 폼을 `DEFAULT_PREFERENCE_FORM`으로 리셋 + 대기 사진 제거, `ConfirmDialog`로 확인

## 6. 공용 컴포넌트

- `shared/ui/dialog.tsx` — `ConfirmDialog`(중앙 확인 다이얼로그, 오버레이 클릭·ESC 취소, `danger` 톤). `window.confirm` 대체용으로 재사용 가능
- `shared/ui/time-field.tsx` — MUI `TimePicker` 래퍼(§5)

## 7. 버그 수정

- 사진 `accept`가 `image/*`인데 백엔드는 jpeg/png/webp만 허용 → FE accept 제한 + 형식·용량 검증
- 업로드했지만 분석 안 한 사진이 저장 시 조용히 유실 → 미분석 사진 있으면 저장 차단 안내
- 재방문 시 서버에 저장된 취향 태그/사진 미표시 → 로드 시 `tasteTags`·`photoUrls`로 복원
- 취향 로딩 중 기본값 깜빡임 → 스켈레톤
- 취침·기상 검증 `wakeTime < sleepTime`(문자열 비교)이 자정 넘는 취침 시각을 오판 → `!==`로 완화
- 그리드 래핑 후 흐트러진 들여쓰기 → Prettier

## 8. 주의사항 / 후속

- `preferences.photoUrls`(jsonb) 컬럼은 dev의 `synchronize`로 자동 반영. ~~**운영 배포 시 마이그레이션 필요**~~ → 해소: 프로덕션은 TypeORM 마이그레이션(`migrationsRun`)이 스키마를 잡는다([deployment §5-2](../ops/deployment-railway-vercel-runpod.md)). 이후 엔티티를 바꿀 땐 `pnpm migration:generate` 로 마이그레이션을 함께 만들어야 한다
- 사진 원본 저장은 `STORAGE_*`(로컬 MinIO / 라이브 R2) 설정 시 동작. 미설정이면 분석만 되고 원본 미보관
- `beforeunload`는 브라우저 레벨 이탈(새로고침·탭 닫기·외부 URL)만 막고, 앱 내부 소프트 네비게이션은 미차단
- 기존 저장 프로필의 옛 필드(travelStyles 등)는 마이그레이션 없이 무시되고 신규 필드는 빈 배열로 폴백

## 9. 주요 파일 · 엔드포인트

- 공통 타입: `packages/types/src/preference.ts`
- 백엔드: `apps/api/src/preferences/{preference.entity,preferences.service,preference-text}.ts`, `apps/api/src/preference-analyzer/{preference-analyzer.controller,preference-analyzer.module,vision.analyzer}.ts`
- 프론트엔드: `apps/web/src/features/preference-setup/ui/preference-setup-form.tsx`, `apps/web/src/features/prompt-preference-setup/`, `apps/web/src/entities/preferences/{model/options,api/preferences-api}.ts`, `apps/web/src/shared/ui/{dialog,time-field}.tsx`, `apps/web/src/widgets/trip-info-panel/ui/trip-info-panel.tsx`
- 엔드포인트: `POST /preference-analyzer/upload`, `DELETE /preference-analyzer/photos?url=`, `GET|PUT /preferences`
