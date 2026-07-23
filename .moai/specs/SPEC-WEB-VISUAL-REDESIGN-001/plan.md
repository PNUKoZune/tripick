# 구현 계획 — SPEC-WEB-VISUAL-REDESIGN-001

> 밀스톤은 **결정 가역성** 기준으로 정렬한다 — 바뀔 가능성이 높은 결정(토큰·다크모드·
> 타임라인 그라데이션 계약·랜딩 구조)을 위로, 기계적 재스타일링을 아래로 둔다.

## §A. 컨텍스트

- 스택: Next.js 16(App Router) + React 19 + **Tailwind v4**(`@tailwindcss/postcss`).
  `@emotion/*` 는 의존성에 있으나 **대상 슬라이스에서는 사용되지 않는다**(grep 확인).
  대상 컴포넌트는 Tailwind arbitrary value(`bg-[#3182F6]`) + `globals.css` CSS 변수
  혼용으로 스타일링한다. → 리디자인은 Tailwind + CSS 변수 토큰 경로로 진행한다(Emotion 도입 금지).
- FSD 슬라이스: `app/` 라우트는 얇은 래퍼(대부분 5~17줄)이고 실제 UI 는
  `views/` · `widgets/` · `features/` · `entities/` 에 있다.
- 아키텍처 판단(unknown-knowns): 코드베이스가 Emotion 이 아닌 Tailwind 를 실사용한다는
  점, 그리고 `apps/web` 에 테스트 스위트가 전무하다는 점을 사전 정찰로 확인했다.

## §B. 사용자 확정 결정 (iteration 2 — clarification 3건 해소 완료)

> 아래 3개 항목은 iteration 1 plan-audit(FAIL 0.69) 이후 orchestrator AskUserQuestion 으로
> 확정됨. 이전 clarification 마커 3건 전부 해소 완료.

- **다크 모드 활성화 → 확정: 시스템 선호도 자동 감지만.** `prefers-color-scheme: dark` 기반 자동
  적용만 구현한다. 뷰어 토글 UI·`data-theme` 훅은 이번 스코프 제외(별도 요청 시 나중에 추가).
  REQ-WVR-003 이 이 결정으로 확정됨.
- **primary 색 시프트(#3182F6 → #2E6BE6) 범위 → 확정: 대상 5개 화면 로컬 스코프만.**
  `shared/ui` 공통 버튼/칩/세그먼트 등 전역 토큰은 **불변**. 대상 화면 내 로컬 오버라이드(CSS
  변수 스코프 또는 화면별 클래스)로만 새 파란색을 쓴다 → §C 의 `shared/ui` 블라스트 반경 우려 해소.
- **재계획 사유 칩·"지금 일정" 비교 블록 → 확정: 제외.** 새 폼 상태를 도입하므로 이번 스코프
  제외(spec.md §D·REQ-WVR-051·AC-WVR-050/GWT-5 에 이미 반영 — 그대로 유지).

## §C. Pre-flight

- [ ] 목업 5개 토큰 블록이 정확히 동일함을 재확인(정본 = 랜딩 목업).
- [ ] `docs/verification/screenshots-2026-05-08-current/` 현행 스크린샷과 대조.
- [x] `shared/ui`(button/chip/segment-toggle/surface-card/app-frame) 전역 토큰은 **이번
      스코프에서 불변**(§B 확정) — 새 파란색은 대상 5개 화면 로컬 오버라이드로만. 블라스트 반경 우려 해소.

## §D. 제약

- 시각·카피·(랜딩)레이아웃 전용. 백엔드·API·검증·상태 머신 불변(REQ-WVR-081).
- `apps/mobile` 불가침.
- 품질 게이트 = `next build` + `tsc --noEmit` + `next lint`(테스트 스위트 부재).

## §E. 자체 검증

- 각 REQ 가 acceptance.md 의 AC 로 추적되는지 확인.
- 5개 화면이 목업과 시각 대조 가능한지(스크린샷) 확인.

## §F. 밀스톤 (가역성 내림차순)

### M1 — 토큰 SSOT + 다크 (가장 잘 바뀌는 결정)
- `design-tokens.ts` 확장 팔레트(라이트+다크) export 추가. 새 파란색 #2E6BE6 은 대상 5개 화면
  로컬 스코프로만(전역 토큰 불변 — §B 확정).
- `globals.css` 에 CSS 변수(라이트) + `@media (prefers-color-scheme: dark)` 정의
  (시스템 자동 감지 — 토글 UI·`data-theme` 훅 없음, §B 확정).
- REQ-WVR-001~004.

### M2 — 결과 화면 타임라인 그라데이션 계약 (시그니처, 신규 타입/매핑)
- 시간 → 시간대 색 매핑 순수 함수(도트 색), 컨테이너 레벨 4-stop 그라데이션 rail.
- `planner-timeline.tsx` + `itinerary-item-card.tsx` 연결선 구조 조정, 상단 요약 카드.
- REQ-WVR-040~043. 기존 카드 어포던스 보존 검증 필수.

### M3 — 랜딩 구조 재편 (레이아웃 자유도 큰 화면, UX 흐름)
- hero SVG 일러스트 컴포넌트, 사진 취향 카피, 4단계 플로우/미리보기/마무리 섹션.
- REQ-WVR-010~013.

### M4 — 취향 입력 재스타일 (상태 머신 카피 화해)
- `preference-setup-form.tsx` 재스타일 + 실제 상태 라벨 화해(대체 아님).
- REQ-WVR-020~022.

### M5 — 여행 조건 입력 재스타일 (기존 필드 한정)
- `trip-create-view.tsx` mega-card 시각, 기존 9개 필드만.
- REQ-WVR-030~032.

### M6 — 재계획 시트 재스타일 (기존 필드 한정)
- `replan-modal.tsx` 시각 재스타일, 기존 필드/상태만.
- REQ-WVR-050~052.

### M7 — 디자인 시스템 문서 + 접근성/비회귀 마감 (기계적)
- `toss-v1.md` → v2/부록: 그라데이션·hero 규칙 완화, 타임라인 그라데이션 패턴 기록.
- 접근성 어포던스·reduced-motion 확인, 품질 게이트 통과.
- REQ-WVR-060, 070~071, 080~081.

## §G. 안티패턴 (피할 것)

- Emotion 도입(대상 슬라이스는 Tailwind). — 기존 스타일 스택과 일관성 유지.
- 재계획/취향/조건 화면에 목업의 신규 필드를 몰래 추가(범위 이탈).
- 존재하지 않는 테스트 스위트를 "통과"로 주장(verification-claim-integrity 위반).
- 하드코딩 hex 를 그대로 두고 다크만 얹기 → 토큰 단일화 원칙 위반.

## §H. 교차 참조

- 목업 5종: `docs/design-system/mockups/tripick-{landing,preference,conditions,result,replan}-mockup.html` (레포 반입 완료 — D3, 임시 scratchpad 경로 폐기)
- 현행 디자인 시스템: `docs/design-system/toss-v1.md`
- 대상 코드: `apps/web/src/{app,views,widgets,features,entities,shared}` (spec.md §B 파일 매핑)
- MX 태그 계획: 시간→색 매핑 함수에 `@MX:NOTE`(시그니처 패턴 의도), 타임라인 rail
  구조 변경부에 `@MX:ANCHOR`(fan_in 다수 카드 렌더) 후보. code_comments: ko.
