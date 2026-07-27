# TriPick 문서 인덱스

취향으로 골라주는 AI 여행 플래너. 각 문서는 기능 단위(`*-v1`)로 결정·근거·검증을 고정한다.
프로젝트 전반 컨텍스트는 최상위 [CLAUDE.md](../CLAUDE.md) 참고.

폴더는 도메인 기준으로 나눈다 — 기능 문서는 도메인 폴더에, 셋업·운영·검증·기획은 성격별 폴더에 둔다.

---

## 개요 · 범위

- [overview/product-v1-scope.md](overview/product-v1-scope.md) — v1 제품 범위·화면·기능 경계

## 셋업 · 실행

- [setup/setup.md](setup/setup.md) — 로컬 개발 환경 셋업 · 실행 검증
- [setup/mobile-webview-setup.md](setup/mobile-webview-setup.md) — React Native WebView 셸 · FCM · Location
- [setup/api-demo-flow.md](setup/api-demo-flow.md) — 백엔드 데모 플로우 (엔드투엔드 호출 흐름)

## 인증

- [auth/email-login-and-session-v1.md](auth/email-login-and-session-v1.md) — 이메일 로그인 · 세션 · 사용자 핸들
- [auth/refresh-token-securestore-v1.md](auth/refresh-token-securestore-v1.md) — refresh 토큰 RN SecureStore 이전 (Keychain/Keystore)

## 여행 (Trips)

- [trips/trip-create-v1.md](trips/trip-create-v1.md) — 새 여행 만들기 (`/trips/new` 폼)
- [trips/destination-tour-api-v1.md](trips/destination-tour-api-v1.md) — 여행 지역 선택 · 관광공사 API 연동
- [trips/per-day-region-v1.md](trips/per-day-region-v1.md) — 여행 일자별 지역 선택 (하루 여러 지역 · planner 지역-스코프 배치)
- [trips/tour-api-opening-hours-v1.md](trips/tour-api-opening-hours-v1.md) — 관광공사 detailIntro2 영업시간 연동
- [trips/trip-progress-live-v1.md](trips/trip-progress-live-v1.md) — 여행 진행(Live) 화면
- [trips/main-page-filters-card-v1.md](trips/main-page-filters-card-v1.md) — 메인 여행 목록 개편(필터·카드)

## 플래너 (Planner) ★

- [planner/main-planner-v1.md](planner/main-planner-v1.md) — Screen 3 메인 플래너 / Screen 4 대안 팝업
- [planner/rag-crag-v1.md](planner/rag-crag-v1.md) — RAG / CRAG 플래너 파이프라인
- [planner/naver-popularity-signal-v1.md](planner/naver-popularity-signal-v1.md) — 네이버 추천 글 대중 인지도 신호 (마이너 장소 소프트 재랭킹)
- [planner/alternative-place-picker-v1.md](planner/alternative-place-picker-v1.md) — 대안 장소 선택(Alternative Popup) · swap · 재계획
- [planner/planner-page-enhancements-v1.md](planner/planner-page-enhancements-v1.md) — 여행 일정 페이지 개편
- [planner/routing-external-api-v1.md](planner/routing-external-api-v1.md) — 길찾기 외부 API 전환(카카오 모빌리티 · ODsay)
- [planner/realtime-websocket-v1.md](planner/realtime-websocket-v1.md) — 실시간 재계획 WebSocket 연동
- [planner/invitee-change-approval-v1.md](planner/invitee-change-approval-v1.md) — 참여자 일정 변경 owner 승인 흐름
- [planner/day-scoped-replan-v1.md](planner/day-scoped-replan-v1.md) — 일자별 부분 재계획(대상 일차만 재생성, 나머지 일차 보존)

## 취향 · 임베딩 (Preference)

- [preference/preference-photo-taste-analysis-v1.md](preference/preference-photo-taste-analysis-v1.md) — 취향 사진 분석(Vision Taste Tagging)
- [preference/preference-embedding-weighting-v1.md](preference/preference-embedding-weighting-v1.md) — 취향 임베딩 가중치 · 어휘 확장 · 사진별 태그 on/off
- [preference/preferences-enhancements-v1.md](preference/preferences-enhancements-v1.md) — 취향 페이지 개편
- [preference/place-embedding-and-preference-personalization-v1.md](preference/place-embedding-and-preference-personalization-v1.md) — 장소·취향 임베딩 파이프라인 & 개인화
- [preference/place-embedding-enrichment-v1.md](preference/place-embedding-enrichment-v1.md) — 장소 임베딩 데이터 강화
- [preference/embedding-server-separation-v1.md](preference/embedding-server-separation-v1.md) — 임베딩 서버 분리

## 알림 · 날씨 · 혼잡 (Alerts)

자동 재계획 없이 "추천 알림"만 보내는 트리거들. 실제 재계획은 사용자가 확인 후 수동 요청.

- [alerts/arrival-check-alert-v1.md](alerts/arrival-check-alert-v1.md) — 미도착 감지 알림(Arrival-Check Alert)
- [alerts/weather-forecast-v1.md](alerts/weather-forecast-v1.md) — 기상청 단기예보 web 실연동
- [alerts/mid-term-forecast-v1.md](alerts/mid-term-forecast-v1.md) — 기상청 중기예보 확장 + 날씨 버그 수정
- [alerts/weather-alert-scheduler-v1.md](alerts/weather-alert-scheduler-v1.md) — 날씨 트리거 알림 스케줄러
- [alerts/crowd-alert-scheduler-v1.md](alerts/crowd-alert-scheduler-v1.md) — 관광지 혼잡(집중률) 트리거 알림 스케줄러
- [alerts/alert-replan-wiring-v1.md](alerts/alert-replan-wiring-v1.md) — 알림 → 재계획 배선 (트리거 프리필 배너 · crowd 트리거)

## 알림 인프라 · 인박스 (Notification)

- [notification/fcm-production-push-v1.md](notification/fcm-production-push-v1.md) — FCM 푸시 production 품질
- [notification/web-push-service-worker-v1.md](notification/web-push-service-worker-v1.md) — 웹 푸시 (Service Worker + VAPID)
- [notification/inbox-and-trip-invite-v1.md](notification/inbox-and-trip-invite-v1.md) — 인박스 · 여행 초대
- [notification/friend-request-push-and-deeplink-v1.md](notification/friend-request-push-and-deeplink-v1.md) — 친구 요청 푸시 + 푸시 탭 딥링크 라우팅

## 친구 · 멤버 (Friends)

- [friends/friends-and-trip-members-v1.md](friends/friends-and-trip-members-v1.md) — 친구 · 여행 멤버 · 조율 재배치
- [friends/friends-page-enhancements-v1.md](friends/friends-page-enhancements-v1.md) — 친구 페이지 개선 (프로필 사진 · 미가입 핸들 거부 · 내 아이디 공유 · 친구와 여행 만들기)

## 설정 (Settings)

- [settings/settings-v1.md](settings/settings-v1.md) — 설정 페이지
- [settings/settings-profile-v1.md](settings/settings-profile-v1.md) — 프로필 도메인 + 페이지 레이아웃 통일
- [settings/account-withdrawal-v1.md](settings/account-withdrawal-v1.md) — 회원 탈퇴 사유 수집 · 2단계 확인 (hard delete 유지)

## 디자인 시스템

- [design-system/toss-v1.md](design-system/toss-v1.md) — 디자인 토큰 · 컴포넌트 규칙 (코드: `apps/web/src/shared/config/design-tokens.ts`)

## 운영 (Ops)

- [ops/deployment-railway-vercel-runpod.md](ops/deployment-railway-vercel-runpod.md) — 배포(Railway · Vercel · RunPod)
- [ops/production-ai-long-term-readiness.md](ops/production-ai-long-term-readiness.md) — production AI 장기 운영 준비
- [ops/test-coverage-expansion-v1.md](ops/test-coverage-expansion-v1.md) — API 테스트 커버리지 확장
- [ops/eslint-flat-config-v1.md](ops/eslint-flat-config-v1.md) — ESLint 9 flat config 워크스페이스 세팅 + react-hooks 오류 해소

## 수정 기록 (Fix)

- [fix/sleep-time-and-dto-validation-v1.md](fix/sleep-time-and-dto-validation-v1.md) — 취침 시간 · DTO 검증 버그 수정

## 검증 · QA (Verification)

- [verification/ai-rag-hardening-2026-06-30.md](verification/ai-rag-hardening-2026-06-30.md) — AI/RAG 하드닝 검증
- [verification/ai-rag-mobile-final-qa-2026-06-30.md](verification/ai-rag-mobile-final-qa-2026-06-30.md) — AI/RAG · 모바일 최종 QA
- [verification/tripick-web-v1-ux-independent-qa-2026-05-08.md](verification/tripick-web-v1-ux-independent-qa-2026-05-08.md) — web v1 UX 독립 QA
- [verification/tripick-web-v1-ux-self-qa-2026-05-09.md](verification/tripick-web-v1-ux-self-qa-2026-05-09.md) — web v1 UX 셀프 QA
- 스크린샷: `verification/screenshots-2026-05-08/`, `verification/screenshots-2026-05-08-current/`

## 기획 (Plans)

- [plans/2026-05-06-tripick-kickoff-plan.md](plans/2026-05-06-tripick-kickoff-plan.md) — 프로젝트 킥오프 플랜

---

## 문서 작성 규칙

새 기능 문서(작업 로그성 `*-v1.md`)는 다음 규칙을 따른다.

**1. 파일 위치 · 이름**

- 도메인 폴더 안에 둔다 — 어디에 속하는지 애매하면 트리거 기준으로 판단(플래너가 부를 때 vs 독립 트리거). 새 도메인이 생기면 폴더를 추가하고 이 인덱스에 항목을 넣는다.
- 이름은 `기능-단위-v1.md` (kebab-case, 기능 1개 = 문서 1개). 개편/후속은 `...-enhancements-v1` · `...-v2` 로.
- 셋업·운영·검증·기획 등 살아있는 참조 문서는 성격 폴더(`setup·ops·verification·plans·design-system`)에 두고 아래 헤더 규칙에서 예외.

**2. 상단 헤더 블록** (제목 바로 아래, 순서 고정)

```markdown
# <제목> v1

문서 목적: <이 문서가 무엇을 고정하는지 한 줄>

기준 브랜치: `feat/...`
작성일: YYYY-MM-DD
선행 문서: [`docs/<cat>/<name>.md`](상대경로) (관계 설명)   ← 있으면
기준 디자인 시스템: [`docs/design-system/toss-v1.md`](상대경로)   ← 화면 작업이면
```

- `문서 목적:` · `기준 브랜치:` · `작성일:` 은 필수. 나머지는 해당될 때만.
- `작성일` 은 문서를 처음 쓴 날. 값이 애매하면 그 문서를 추가한 첫 커밋 날짜(`git log --follow --diff-filter=A`)를 쓴다.

**3. 링크 규칙**

- 문서 간 링크: 같은 폴더는 `./name.md`, 다른 폴더는 `../<cat>/name.md`. 표시 텍스트는 루트 기준 전체 경로(`docs/<cat>/name.md`)로 적어 폴더가 바뀌어도 의미가 남게 한다.
- 코드 참조: 문서에서 루트까지 `../../` 후 `apps/…` · `packages/…`. 파일이 사라지면 링크를 풀고 "대체·제거됨" 을 명시한다(끊긴 링크로 남기지 않는다).
- 프로젝트 전반 컨텍스트는 [CLAUDE.md](../CLAUDE.md) 를 절 번호로 가리킨다(예: §7).
