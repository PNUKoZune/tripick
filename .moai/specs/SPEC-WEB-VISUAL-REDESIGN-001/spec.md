---
id: SPEC-WEB-VISUAL-REDESIGN-001
title: "웹앱 비주얼 리디자인 — 광안리의 하루 (light of the day)"
version: "0.1.1"
status: in-progress
created: 2026-07-22
updated: 2026-07-23
author: manager-spec
priority: P1
phase: "web design-system v2"
module: "apps/web/src"
lifecycle: spec-anchored
tags: "frontend, ui, design-system, redesign, nextjs, tailwind"
tier: M
---

# SPEC-WEB-VISUAL-REDESIGN-001 — 웹앱 비주얼 리디자인 "광안리의 하루"

## HISTORY

| version | date | author | change |
|---------|------|--------|--------|
| 0.1.0 | 2026-07-22 | manager-spec | 최초 작성 — 승인된 "광안리의 하루" 방향을 GEARS SPEC 으로 고정 |
| 0.1.1 | 2026-07-22 | manager-spec | iteration 2 plan-audit(FAIL 0.69) 수정 — clarification 3건 확정(다크=시스템 자동만 / primary 로컬 스코프 / 재계획 사유 칩 제외), 목업 경로 레포 반입(D3), REQ-003/004 확정 |

---

## §A. 배경과 목적

### A.1 문제 (WHY)

현재 TriPick 웹앱(Next.js WebView)의 첫인상은 "AI 데모"처럼 읽힌다. 특히 랜딩은
개발자 관점 카피와 균일한 흰색 정보 타일의 반복 그리드로 구성돼, 사진 취향으로
여행을 골라주는 서비스의 감성·개성이 전혀 드러나지 않는다. 자동 디자인 툴(Lazyweb)
시도는 반려됐고, Claude + Fable-5 서브에이전트로 손으로 만든 방향("광안리의 하루")이
사용자에게 명시적으로 승인됐다("어우 너무 좋은데? 완벽하다"). 본 SPEC 은 그 **이미
승인된 시각 방향을 실제 프로덕션 코드에 반영**하기 위한 것이다.

### A.2 방향 (WHAT — 요약)

- 기존 Toss 스타일 기반(신뢰감·정돈·모바일 우선·카드 리듬)을 **유지·진화**한다. 리브랜딩이 아니다.
- `docs/design-system/toss-v1.md` §3/§11 의 두 규칙("그라데이션 금지" / "hero 배경
  이미지·일러스트 금지")을 **의도적으로 완화**한다: 랜딩에 hero 일러스트(인라인 SVG,
  사진 아님)를, 결과 화면에 시그니처 타임라인 그라데이션을 도입한다.
- 시그니처 패턴 "하루의 빛": 결과 화면 타임라인 연결선이 시간대에 따라 색이 변하는
  4-stop 그라데이션(아침 파랑 → 낮 파랑 → 오후 금빛 → 저녁 코랄)이며, 랜딩 hero 의
  광안리 노을 장면과 같은 시각 언어를 재사용한다.
- 모든 메타/개발자 카피를 제거하고, 모든 화면이 여행자에게 말을 건넨다.

### A.3 범위 요약 (SCOPE)

**시각·카피·(랜딩) 레이아웃 전용.** 백엔드·API·스키마·폼 검증·상태 머신·데이터
흐름 변경은 없다. 대상은 `apps/web`(Next.js WebView) 전용이며 `apps/mobile`(RN 네이티브)은 건드리지 않는다.

### A.4 정본 참조 (SOURCE OF TRUTH)

승인된 시각 정본은 5개 정적 목업(HTML/CSS)이며 **레포에 반입됐다**: `docs/design-system/mockups/`
(D3 — 이전 임시 scratchpad 경로 폐기, 레포 반입으로 감사 시점 재현성 확보). 색·간격·컴포넌트
구조·카피·마이크로 인터랙션은 이 파일들에서 **추출**하며 산문에서 재유도하지 않는다.

1. `docs/design-system/mockups/tripick-landing-mockup.html` — 랜딩 (토큰 정본 — 나머지 목업이 동일 CSS 커스텀 프로퍼티 블록을 재사용)
2. `docs/design-system/mockups/tripick-preference-mockup.html` — 취향 입력
3. `docs/design-system/mockups/tripick-conditions-mockup.html` — 여행 조건 입력
4. `docs/design-system/mockups/tripick-result-mockup.html` — 결과(일자별 타임라인)
5. `docs/design-system/mockups/tripick-replan-mockup.html` — 재계획 바텀시트

---

## §B. 요구사항 (GEARS)

> 표기: GEARS(현행). 주어(`<subject>`)는 시스템에 한정하지 않는다.

### B.1 디자인 토큰 (SSOT)

- **REQ-WVR-001** (Ubiquitous): `apps/web/src/shared/config/design-tokens.ts` 와
  `apps/web/src/app/globals.css` 는 5개 목업의 **정본 CSS 커스텀 프로퍼티 블록**과
  동일한 확장 팔레트를 노출해야 한다(shall). 여기에는 종이/잉크 계열, `--primary`
  계열(#2E6BE6/#1F55C4/#EAF1FE), sunset accent 계열(`--accent`/`--accent-deep`/`--accent-tint`/`--hl`),
  4-stop 타임라인 색(`--t-morning`/`--t-noon`/`--t-gold`/`--t-dusk`), 광안리 장면 색
  (`--sky-*`/`--sun*`/`--sea-*`/`--sil`/`--bridge`/`--lights`) 이 포함된다.
- **REQ-WVR-002** (Ubiquitous): 토큰 정의는 라이트·다크 두 값 세트를 모두 정의해야 한다(shall).
  다크 값은 목업의 다크 블록과 동일하다.
- **REQ-WVR-003** (Where, capability gate): OS 가 다크 색상 스킴을 보고할 때(`prefers-color-scheme: dark`),
  웹앱은 대상 5개 화면의 다크 토큰 세트를 적용해야 한다(shall). *(사용자 확정: 다크는 **시스템 선호도 자동 감지만** 구현 — 뷰어 테마 토글 UI 나 `data-theme` 훅은 이번 스코프 제외. 별도 요청 시 추가.)*
- **REQ-WVR-004** (Ubiquitous): 컴포넌트가 현재 하드코딩한 hex 값(예: `bg-[#3182F6]`,
  `text-[#191F28]`)은 대상 5개 화면 범위 안에서 확장 팔레트 토큰(CSS 변수)로 대체돼야
  한다(shall) — 라이트/다크 전환이 토큰 한 곳에서 이뤄지도록. *(사용자 확정: 새 파란색 #2E6BE6 은
  대상 5개 화면에 **로컬 스코프로만** 적용 — `shared/ui` 전역 버튼/칩/세그먼트 토큰은 이번 스코프에서 불변.)*

### B.2 랜딩 (mockup 1 → `app/page.tsx` + `views/landing/ui/`)

- **REQ-WVR-010** (Ubiquitous): 랜딩 hero 는 광안리 노을 장면 인라인 SVG 일러스트를
  렌더해야 한다(shall)(하늘 그라데이션·해·해무리·갈매기·먼 산·바다 3단·노을 반사·작은 배·광안대교). 사진/래스터 이미지가 아니다.
- **REQ-WVR-011** (Ubiquitous): 랜딩 카피는 사진 취향 프레이밍으로 재작성돼야 한다(shall):
  eyebrow "취향으로 골라주는 AI 여행 플래너", 헤드라인 "당신의 사진첩은 이미 다음
  여행을 알고 있어요"(마커 하이라이트 포함), 그리고 4단계 플로우·"미리 보는 결과"·마무리 섹션.
- **REQ-WVR-012** (Ubiquitous): 랜딩은 개발자·메타 카피를 포함하지 않아야 한다(shall not).
  대상 문자열에는 최소한 "이번 정리 기준", "화면 가이드", "현재 단계" 가 포함된다. *(참고: 현재 소스에 이 문자열은 존재하지 않으므로 회귀 가드로 검증한다 — acceptance §D.)*
- **REQ-WVR-013** (Ubiquitous): 4단계 플로우 섹션은 좋아하는 사진 고르기 → 여행 조건
  알려주기 → 완성된 일정 받기 → 마음 바뀌면 다시 짜기의 점선 스텝 타임라인으로
  렌더해야 한다(shall). *(현행 "취향 저장/멤버 추가/취향 조율" 3-스텝 카피를 대체한다.)*

### B.3 취향 입력 (mockup 2 → `app/preferences/page.tsx` + `views/preferences/ui/` + `features/preference-setup/ui/preference-setup-form.tsx`)

- **REQ-WVR-020** (Ubiquitous): 취향 입력 화면은 목업의 시각 언어(앱바 + 4px 진행바,
  사진 그리드 타일, 분석-중 스캔 카드, 분석 결과 카드, 선호/불호 태그, 선호 이동수단
  세그먼트, 하루의 리듬 밴드)로 재스타일링돼야 한다(shall).
- **REQ-WVR-021** (Ubiquitous): 목업 카피는 실제 상태 머신 라벨과 화해(reconcile)해야
  한다(shall) — 실제 라벨을 대체하지 않는다. 실제 라벨 예: "사진 분석 완료",
  "사진에서 취향을 분석했어요", "테마/장소 선호도", "취침 / 기상 시간", "선호 이동 수단",
  "여행 페이스", "활동 강도", "선호"/"불호".
- **REQ-WVR-022** (While, state-driven): 사진 분석이 진행 중인 동안, 취향 입력 화면은
  목업의 스캔-카드 진행 표현(진행 트랙 + 점 애니메이션 + 단계 문구)으로 표시해야
  한다(shall). 기존 분석 상태 전이 로직은 그대로 유지한다.

### B.4 여행 조건 입력 (mockup 3 → `app/trips/new/page.tsx` + `views/trip-create/ui/trip-create-view.tsx`)

- **REQ-WVR-030** (Ubiquitous): 여행 조건 화면은 목업의 mega-card 시각 언어(그룹 구분
  점선, 필드/세그먼트/칩/자유서술 스타일, sticky CTA)로 재스타일링돼야 한다(shall).
- **REQ-WVR-031** (Ubiquitous): **기존 필드만** 재스타일링해야 한다(shall) — 여행 제목,
  여행 지역, 여행 기간, 동행자, 이동 수단, 일정 강도, 예산, 꼭 포함할 장소, 이번 여행에
  반영할 사항. 새 필드를 발명하거나 기존 필드를 제거하지 않는다(shall not).
- **REQ-WVR-032** (When, event-driven): 여행 지역이 비어 CTA 가 비활성일 때, 화면은
  Toss식 disabled CTA + 비활성 사유 helper 문구를 표시해야 한다(shall) — 기존 `canSubmit` 로직 유지.

### B.5 결과 / 플래너 (mockup 4 → `app/planner/page.tsx` + `views/planner/ui/planner-view.tsx` + `widgets/planner-timeline/ui/planner-timeline.tsx` + `entities/itinerary-item/ui/itinerary-item-card.tsx`)

- **REQ-WVR-040** (Ubiquitous): 결과 화면은 목업의 상단 요약 카드(상태 칩, 여행명,
  기간, "하루의 빛" 가로 미니 레일, 핵심 톤 그라데이션 레일, 태그, 취향 출처 문구)로
  재스타일링돼야 한다(shall).
- **REQ-WVR-041** (Ubiquitous): 일자별 타임라인 연결선은 4-stop 시간대 그라데이션
  (`--t-morning` → `--t-noon` → `--t-gold` → `--t-dusk`)을 사용해야 한다(shall). 이것이
  본 리디자인의 시그니처 패턴이다.
- **REQ-WVR-042** (Ubiquitous): 각 일정 항목의 타임라인 도트 색은 항목 시각의 시간대에서
  결정돼야 한다(shall) — 순수 매핑 함수(백엔드 호출 없음). *(그라데이션 rail 은 컨테이너 레벨, 도트는 항목별.)*
- **REQ-WVR-043** (Ubiquitous): 기존 항목 카드 어포던스는 보존돼야 한다(shall):
  `react-icons/lu` 아이콘, `@/shared/ui` `Chip`, 드래그 재정렬 grip, 카카오맵 링크,
  대안 전환("변경") 버튼, 수정/삭제 컨트롤.

### B.6 재계획 바텀시트 (mockup 5 → `features/request-replan/ui/replan-modal.tsx`)

- **REQ-WVR-050** (Ubiquitous): 재계획 시트는 목업의 시각 언어(grabber, 질문 헤더,
  세그먼트, 칩, 자유서술, primary CTA, 전송-후 로딩 상태 표현)로 재스타일링돼야 한다(shall).
- **REQ-WVR-051** (Ubiquitous): **기존 필드/상태만** 재스타일링해야 한다(shall) —
  자유서술("어떻게 바꿀까요?"), 꼭 포함할 장소, 일정 강도, 예산, 피하고 싶은 것, 이동
  동선 최소화 스위치, primary CTA. 새 폼 상태·필드를 추가하지 않는다(shall not). *(목업의
  사유 칩·"지금 일정" 비교 블록은 새 폼 상태를 도입하므로 Out of Scope.)*
- **REQ-WVR-052** (While, state-driven): 재계획 요청 전송이 진행 중인 동안, CTA 는
  로딩 상태 문구를 표시해야 한다(shall) — 기존 `mutation.isPending` 카피("요청 중…")를
  유지하거나 목업의 로딩 시각(스피너)만 반영. 기존 owner/제안 분기 로직은 유지한다.

### B.7 디자인 시스템 문서

- **REQ-WVR-060** (Ubiquitous): `docs/design-system/toss-v1.md` 는 버전 갱신(v1 → v2,
  또는 부록 섹션)돼야 한다(shall) — 완화된 그라데이션/hero-일러스트 규칙과 새 타임라인
  그라데이션 패턴을 기록해, 다른 엔지니어가 참조하는 SSOT 로서 정확성을 유지한다.

### B.8 접근성 보존 (non-regression)

- **REQ-WVR-070** (Ubiquitous): 목업이 이미 모델링한 접근성 어포던스는 그대로 이어져야
  한다(shall): focus-visible 링, aria 라벨, 시맨틱 폼 요소(fieldset/legend/label/role),
  진행바 role, 장식 SVG 의 `aria-hidden`.
- **REQ-WVR-071** (Where, capability gate): 사용자가 모션 감소를 선호할 때
  (`prefers-reduced-motion: reduce`), 진입/스캔/스피너 애니메이션은 비활성돼야 한다(shall).

### B.9 비회귀 (품질 게이트)

- **REQ-WVR-080** (Ubiquitous): 리디자인 후 `apps/web` 는 `next build`, `tsc --noEmit`,
  `next lint` 가 모두 통과해야 한다(shall). *(참고: `apps/web` 에는 현재 테스트 스위트가
  존재하지 않으므로 — 자동 테스트 통과가 아니라 이 3개 게이트가 비회귀 기준이다.)*
- **REQ-WVR-081** (Ubiquitous): 재스타일링은 기존 폼 검증·상태 머신·데이터 흐름을
  변경하지 않아야 한다(shall not).

---

## §C. 인수 기준 참조

전체 AC 매트릭스와 Given-When-Then 시나리오는 `acceptance.md` 를 정본으로 한다.

---

## §D. Exclusions — 범위에서 제외 (What NOT to build)

이 SPEC 은 시각·카피·(랜딩)레이아웃에만 한정되며, 다음은 **out of scope** 이다.

### Out of Scope — 백엔드 / API / 데이터
- 새 API 엔드포인트, 새 요청/응답 필드, DB 스키마·마이그레이션 변경 금지.
- 폼 검증 규칙, 상태 머신, 데이터 흐름(생성/재계획/취향 분석 로직) 변경 금지.

### Out of Scope — 모바일 네이티브
- `apps/mobile`(React Native 네이티브 화면)은 건드리지 않는다.

### Out of Scope — 목업에만 있는 신규 어포던스 (새 필드/상태)
- 재계획 시트의 "사유 칩"(이동이 너무 길어요/웨이팅/날씨) — 새 폼 상태를 도입하므로 제외.
- 재계획 시트의 "지금 일정" 비교 블록 — 새 데이터 표현/상태를 도입하므로 제외.
- 취향 결과 카드의 신뢰도 %(예: 92%) 표기 — 실제 데이터에 대응이 없으면 제외.

### Out of Scope — 테마 토글 / 신규 기능
- 수동 라이트/다크 테마 토글 UI 는 도입하지 않는다(다크는 시스템 선호도 기반만).
- 지도 뷰, 신규 화면, 신규 라우트 추가 금지.
