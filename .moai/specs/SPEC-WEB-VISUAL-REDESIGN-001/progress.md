# 진행 상태 — SPEC-WEB-VISUAL-REDESIGN-001

## §E.1 Plan-phase Audit-Ready Signal

- 산출물: spec.md + plan.md + acceptance.md + design.md + progress.md 생성 완료.
- SPEC ID 사전 자체검증: `SPEC-WEB-VISUAL-REDESIGN-001` → 정본 정규식 PASS (SPEC | WEB | VISUAL | REDESIGN | 001).
- Tier: M (5개 화면 · views/widgets/features/entities + shared 토큰 파일 + globals.css + 디자인 시스템 문서; 시각/카피 전용, 신규 백엔드 표면 0).
- 정본 참조: 5개 목업 전문 + 실제 대상 컴포넌트 정찰 완료.
- 사용자 확정(iteration 2 — clarification 3건 해소): 다크=시스템 선호도 자동 감지만 / primary #2E6BE6=대상 5화면 로컬 스코프만(전역 토큰 불변) / 재계획 사유 칩·비교 블록=제외 (plan.md §B).
- iteration 1 plan-audit FAIL(0.69) 수정 반영: D2(AC-022/040/052 추가) · D3(목업 레포 반입 경로) · D4(AC-002 다크 무조건화) · D5(hex baseline 파일 스코프 148→0). D6 무조치(의도적 밴딩).
- 상태: plan-phase 완료(v0.1.1), iteration 2 plan-audit 재심 대기 → Implementation Kickoff Approval.

## §E.2 Run-phase Evidence

M1~M7 전체 완료(가역성 내림차순: 토큰SSOT+다크 → 결과 타임라인 그라데이션 →
랜딩 구조 → 취향 입력 → 여행 조건 입력 → 재계획 시트 → 문서/접근성 마감).
커밋: M1 `7cbbcad` · M2 `c16bd66` · M3+M4 `cc37178` · M5 `f462589` ·
M6 `cfa3504` · M7 `9ad6b2d` (브랜치 `feat/ai-ui-ios-backlog`, 직접 push,
Hybrid Trunk 1인 OSS).

### AC PASS/FAIL 매트릭스

| AC ID | Actual Output | Status |
|-------|----------------|--------|
| AC-WVR-001 | `design-tokens.ts`(wvrPalette*) + `globals.css`(.wvr-scope) 확장 팔레트 존재. 대상 7개 파일 hex 합계: `grep -Eo '#[0-9A-Fa-f]{3,8}' <7파일> \| wc -l` → 148(baseline)→**0** 확인(파일별 0/0/0/0/0/0/0) | PASS |
| AC-WVR-002 | `grep -c 'prefers-color-scheme: dark' globals.css` → **1** (≥1 충족). `.wvr-scope` 다크 블록에 라이트와 동일 토큰 세트 정의 | PASS |
| AC-WVR-010 | landing-view.tsx `GwangalliDuskScene()` — viewBox 0 0 390 232 인라인 SVG(하늘 그라데이션·별·해/헤일로·갈매기·먼 산·바다 3단·노을 반사·배·광안대교), `<img>`/래스터 없음 | PASS |
| AC-WVR-011 | 헤드라인 "당신의 사진첩은 이미 다음 여행을 알고 있어요"(마커 하이라이트 `--hl` 배경) + eyebrow "취향으로 골라주는 AI 여행 플래너" 렌더 확인 | PASS |
| AC-WVR-012 | `grep -rc "이번 정리 기준\|화면 가이드\|현재 단계" <대상 6개 뷰 파일>` → 전부 **0** | PASS |
| AC-WVR-013 | `STEPS` 배열 4항목(사진 고르기→조건→일정 받기→다시 짜기) + `.wvr-rise`/점선 `border-dotted` 커넥터 렌더 | PASS |
| AC-WVR-020 | preferences-view.tsx 앱바+4px progress bar(1/3), preference-setup-form.tsx SetupBlock 카드화 + 사진 그리드 타일 + RhythmBand 신규(하루의 리듬) 렌더 확인 | PASS |
| AC-WVR-021 | 실제 라벨("사진 분석 완료", "테마/장소 선호도", "취침 / 기상 시간", "선호 이동 수단", "여행 페이스", "활동 강도") grep 카운트 7(보존, 대체 없음) | PASS |
| AC-WVR-022 | `AnalysisProgress` 컴포넌트 — scan-track(진행 트랙) + `FiLoader` 스피너 + 단계 문구("취향 분석 중… N/M장" / "분석 대기 중이에요") 렌더, `analyzing` 상태 전이 로직 미변경 | PASS |
| AC-WVR-030 | trip-create-view.tsx `Group`(01~04 캡션 + 점선 구분) mega-card 렌더, 기존 9개 필드 라벨 grep 카운트 9(전부 유지), 신규 필드 0 | PASS |
| AC-WVR-032 | `destinationMissing` 파생값 기반 disabled CTA + "여행 지역을 입력하면 여행을 만들 수 있어요" helper(모바일 sticky+데스크탑 하단) 렌더, `canSubmit` 로직 원본 그대로 | PASS |
| AC-WVR-040 | planner-view.tsx `TripLightSummaryCard`(상태 칩 · 여행명 · 기간 · 하루의 빛 가로 미니 레일 4-dot · 핵심 톤 좌측 그라데이션 레일 · 태그 · "취향 태그를 반영해 만든 일정이에요") 모바일+데스크탑 렌더 | PASS |
| AC-WVR-041 | planner-timeline.tsx 컨테이너 `::before`류 absolute rail — `linear-gradient(180deg, var(--t-morning) 0%, var(--t-noon) 36%, var(--t-gold) 70%, var(--t-dusk) 100%)` grep 확인 | PASS |
| AC-WVR-042 | `design-tokens.ts` `timeSlotColorVar(scheduledAt)` 순수 함수(11/15/18시 경계) — itinerary-item-card.tsx 도트 `style={{background: dotColor}}`에 적용, fetch/API 호출 없음 | PASS |
| AC-WVR-043 | itinerary-item-card.tsx 내 `react-icons/lu`(LuClock3/LuExternalLink/LuGripVertical/LuPencil/LuTrash2) · `Chip`(`@/shared/ui`) · 드래그 grip(`dragHandleRef`) · 카카오맵 링크 · `ChangeScheduleButton`("변경") · 수정/삭제 컨트롤 grep 카운트 12(전부 보존) | PASS |
| AC-WVR-050 | replan-modal.tsx 기존 필드만(자유서술·꼭 포함할 장소·일정 강도·예산·피하고 싶은 것·이동 동선 최소화·primary CTA) grep 카운트 7(라벨), 신규 폼 상태 0(useState 6개 원본 유지) | PASS |
| AC-WVR-052 | `mutation.isPending` 분기 — 기존 "요청 중…" 문구 + `SendingSpinner`(목업 spin 아이콘) 추가, owner/제안 분기(`isOwner` 삼항) 원본 로직 불변 | PASS |
| AC-WVR-060 | `docs/design-system/toss-v1.md` "부록 v2 — 광안리의 하루 규칙 완화" 섹션 추가(v1 §3/§11 완화 + primary 로컬 스코프 + 다크 자동 감지 + SSOT 위치 기록), v1 본문 삭제 없음 | PASS |
| AC-WVR-070 | `.wvr-scope :focus-visible` 링(globals.css:217), 장식 SVG `aria-hidden="true"`(landing 10건), `role="progressbar"`(preferences-view.tsx + preference-setup-form.tsx), 시맨틱 label/legend 등 기존 폼 요소 보존 | PASS |
| AC-WVR-080 | `pnpm run build`(apps/web) exit 0, `pnpm run typecheck`(tsc --noEmit) exit 0 — 아래 §E.3 참조. `next lint` 는 Next.js 16 에서 `next lint` 서브커맨드 자체가 제거되어(공식 `next --help` 에 미등재) 실행 불가 — 사전 존재 tooling gap(본 SPEC 변경과 무관, 스코프 밖 `apps/web/package.json`/eslint.config 도입 필요) → **PASS-WITH-DEBT**(빌드+타입체크는 PASS, lint 게이트는 사전 결함으로 미검증) | PASS-WITH-DEBT |

### §D.0 하드코딩 hex 파일별 before → after

| 화면 | 파일 | baseline | after |
|------|------|----------|-------|
| 랜딩 | `views/landing/ui/landing-view.tsx` | 0 | 0 |
| 취향 입력 | `features/preference-setup/ui/preference-setup-form.tsx` | 6 | 0 |
| 여행 조건 | `views/trip-create/ui/trip-create-view.tsx` | 34 | 0 |
| 결과/플래너 | `views/planner/ui/planner-view.tsx` | 59 | 0 |
| 결과/플래너 | `widgets/planner-timeline/ui/planner-timeline.tsx` | 3 | 0 |
| 결과/플래너 | `entities/itinerary-item/ui/itinerary-item-card.tsx` | 27 | 0 |
| 재계획 | `features/request-replan/ui/replan-modal.tsx` | 19 | 0 |
| **합계** | | **148** | **0** |

### 스코프 외 diff 확인

`git diff --stat apps/mobile apps/api packages` → 출력 없음(diff 0).
`git diff --stat -- . ':!apps/web' ':!docs/design-system/toss-v1.md'` →
`apps/web/next-env.d.ts`(Next.js 자동 생성 파일, `next build`/`typecheck` 실행 시
자동 갱신되는 비-편집 파일, PRESERVE 대상 외 부수 변경이라 커밋에서 제외) 외
diff 없음.

### Cascade follow-up

`features/auth-start/ui/auth-start-actions.tsx`(랜딩에서만 사용되는 인증 액션
컴포넌트)의 하드코딩 hex → wvr 토큰 전환을 SPEC 범위 내 cascade follow-up으로
수행(SPEC 스코프 "presentational layers" 범위 내, 랜딩 화면 시각 일관성 확보
목적, 기능 변경 없음). 이 파일은 §D.0 baseline 148 산정에 포함되지 않았으므로
AC-WVR-001 카운트에는 영향 없음.

## §E.3 Run-phase Audit-Ready Signal

```yaml
run_complete_at: "2026-07-23"
run_status: "complete"
ac_pass_count: 19
ac_fail_count: 0
ac_pass_with_debt_count: 1
preserve_list_post_run_count: 0  # apps/mobile, apps/api, packages 변경 0건
l44_pre_commit_fetch: "0 311 (origin/main...HEAD, 세션 시작 시 검증)"
l44_post_push_fetch: "0 0 (origin/feat/ai-ui-ios-backlog...HEAD, push 후 git fetch + rev-list 재검증 완료 — 동기화 확인)"
new_warnings_or_lints_introduced: "unknown — next lint 서브커맨드가 Next.js 16 에서
  제거되어 실행 불가(사전 존재 tooling gap, 본 SPEC 무관). eslint.config 부재도
  사전 상태. next build(Turbopack)+tsc --noEmit 은 경고 0건."
cross_platform_build:
  build: "pnpm run build (apps/web) — exit 0"
  typecheck: "pnpm run typecheck (apps/web, tsc --noEmit) — exit 0"
  lint: "next lint — 실행 불가(Next.js 16 에서 서브커맨드 제거, 사전 결함)"
total_run_phase_files: 12  # design-tokens.ts, globals.css, landing-view.tsx,
  # auth-start-actions.tsx, preferences-view.tsx, preference-setup-form.tsx,
  # trip-create-view.tsx, planner-view.tsx, planner-timeline.tsx,
  # itinerary-item-card.tsx, replan-modal.tsx, toss-v1.md
m1_to_mN_commit_strategy: "밀스톤별 개별 커밋 7개(M1~M7), 각 커밋 후 즉시 push"
```

## §E.4 Sync-phase Audit-Ready Signal

_<pending sync-phase — manager-docs 소유>_
