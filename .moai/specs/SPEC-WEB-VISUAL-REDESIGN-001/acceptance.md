# 인수 기준 — SPEC-WEB-VISUAL-REDESIGN-001

정본 검증 대상: 5개 목업(시각 대조) + `next build`/`tsc --noEmit`/`next lint`(비회귀).
`apps/web` 에는 자동 테스트 스위트가 없으므로 "테스트 통과"가 아닌 이 3개 게이트가 기준이다.

## §D.0 하드코딩 hex 파일 스코프 baseline (D5 — repo 전역 주장 대체)

iteration 1 의 AC-WVR-001 "신규 하드코딩 hex 부재" 는 측정 불가였다: `apps/web/src` 전역에
임의 hex 가 1100+ 개(측정일 1171개) 존재해 "신규" 를 정의할 baseline 이 없었다. 이를 **대상
5개 화면의 리디자인 파일**만 스코프로 하는 파일 단위 diff 로 재정의한다(repo 전역 주장 아님).

측정 명령: `grep -Eo '#[0-9A-Fa-f]{3,8}' <file> | wc -l` (2026-07-22, 리디자인 착수 전).
결과 화면은 3개 파일(view+timeline+card)에 걸치므로 대상 파일은 총 7개.

| # | 화면 | 파일 (`apps/web/src/`) | pre-redesign hex baseline |
|---|------|------------------------|---------------------------|
| 1 | 랜딩 | `views/landing/ui/landing-view.tsx` | 0 |
| 2 | 취향 입력 | `features/preference-setup/ui/preference-setup-form.tsx` | 6 |
| 3 | 여행 조건 | `views/trip-create/ui/trip-create-view.tsx` | 34 |
| 4 | 결과/플래너 | `views/planner/ui/planner-view.tsx` | 59 |
| 4 | 결과/플래너 | `widgets/planner-timeline/ui/planner-timeline.tsx` | 3 |
| 4 | 결과/플래너 | `entities/itinerary-item/ui/itinerary-item-card.tsx` | 27 |
| 5 | 재계획 | `features/request-replan/ui/replan-modal.tsx` | 19 |
| | | **합계 (baseline)** | **148** |

**post-redesign assert**: 위 7개 파일 전체 hex 카운트 합 = **0**(전부 확장 팔레트 CSS 변수로
토큰화). 랜딩(현재 0)은 hero SVG 도입 후에도 0 유지 — 광안리 장면 색은 design.md §3 토큰을
참조하며 인라인 hex 를 쓰지 않는다.
검증: `grep -Eo '#[0-9A-Fa-f]{3,8}' <7개 파일> | wc -l` → `0`.

## §D. AC 매트릭스

| AC ID | 대응 REQ | 검증 방법 |
|-------|----------|-----------|
| AC-WVR-001 | REQ-WVR-001/004 | `design-tokens.ts`·`globals.css` 에 확장 팔레트 CSS 변수(정본 블록과 동일 hex) 존재 **AND** §D.0 의 7개 대상 파일 하드코딩 hex 후처리 합계 = 0 (baseline 148 → 0, 완전 토큰화). repo 전역 주장 아님 — 파일 스코프 diff |
| AC-WVR-002 | REQ-WVR-002/003 | 다크 토큰 값 정의 + 대상 5개 화면 신규 토큰에 대해 `globals.css` 에 `@media (prefers-color-scheme: dark)` 분기 존재(시스템 자동 감지 — 사용자 확정). `grep -c 'prefers-color-scheme: dark' globals.css` ≥ 1 |
| AC-WVR-010 | REQ-WVR-010 | 랜딩 hero 가 광안리 노을 인라인 SVG 를 렌더(래스터 이미지 아님) |
| AC-WVR-011 | REQ-WVR-011 | 랜딩 카피 = "당신의 사진첩은 이미 다음 여행을 알고 있어요" 등 사진 취향 프레이밍 |
| AC-WVR-012 | REQ-WVR-012 | 랜딩(및 대상 화면)에 "이번 정리 기준"/"화면 가이드"/"현재 단계" 문자열 부재 (grep=0) |
| AC-WVR-013 | REQ-WVR-013 | 4단계 플로우(사진 고르기→조건→일정 받기→다시 짜기) 점선 스텝 렌더 |
| AC-WVR-020 | REQ-WVR-020 | 취향 화면 시각 언어(진행바 4px·사진 그리드·스캔 카드·선호/불호 태그·리듬 밴드) |
| AC-WVR-021 | REQ-WVR-021 | 실제 상태 라벨("사진 분석 완료" 등) 보존 — 대체 아님 |
| AC-WVR-022 | REQ-WVR-022 | 사진 분석 진행 중 스캔-카드 진행 표현(진행 트랙 + 점 애니메이션 + 단계 문구) 렌더 — 기존 분석 상태 전이 로직 불변 |
| AC-WVR-030 | REQ-WVR-030/031 | 조건 화면 mega-card 재스타일, 기존 9개 필드 전부 유지·신규 필드 0 |
| AC-WVR-032 | REQ-WVR-032 | 여행 지역 공란 시 disabled CTA + 사유 helper (기존 canSubmit 유지) |
| AC-WVR-040 | REQ-WVR-040 | 결과 상단 요약 카드(상태 칩·여행명·기간·"하루의 빛" 가로 미니 레일·핵심 톤 그라데이션 레일·태그·취향 출처 문구) 렌더 |
| AC-WVR-041 | REQ-WVR-041 | 타임라인 연결선이 4-stop 시간대 그라데이션(`--t-morning`→`--t-dusk`) 사용 |
| AC-WVR-042 | REQ-WVR-042 | 항목 도트 색이 항목 시각 기반(순수 매핑, 백엔드 호출 없음) |
| AC-WVR-043 | REQ-WVR-043 | 항목 카드 어포던스 보존(lu 아이콘·Chip·grip·카카오맵·"변경"·수정/삭제) |
| AC-WVR-050 | REQ-WVR-050/051 | 재계획 시트 재스타일, 기존 필드/상태만·신규 폼 상태 0 |
| AC-WVR-052 | REQ-WVR-052 | 재계획 전송 중 CTA 로딩 상태 문구(기존 `mutation.isPending` "요청 중…" 유지 또는 목업 스피너) 표시 — 기존 owner/제안 분기 로직 불변 |
| AC-WVR-060 | REQ-WVR-060 | `toss-v1.md` 버전 갱신(그라데이션·hero 완화 + 타임라인 그라데이션 패턴 기록) |
| AC-WVR-070 | REQ-WVR-070/071 | focus-visible·aria·시맨틱 폼·reduced-motion 어포던스 보존 |
| AC-WVR-080 | REQ-WVR-080/081 | `next build`+`tsc --noEmit`+`next lint` 통과, 상태 머신/검증 불변 |

## §D.1 Given-When-Then 시나리오

### GWT-1 — 랜딩 hero 일러스트 & 카피 (REQ-WVR-010/011/012)
- **Given** 로그인하지 않은 사용자가 `/` 에 진입하고
- **When** 랜딩이 렌더되면
- **Then** hero 영역에 광안리 노을 인라인 SVG(하늘 그라데이션·해·바다·광안대교)가 보이고,
  헤드라인은 "당신의 사진첩은 이미 다음 여행을 알고 있어요" 이며,
  "이번 정리 기준"/"화면 가이드"/"현재 단계" 문자열은 어디에도 없다.

### GWT-2 — 시그니처 타임라인 그라데이션 (REQ-WVR-041/042)
- **Given** 완성된 일정이 있는 여행의 결과 화면에서
- **When** 일자별 타임라인이 렌더되면
- **Then** 연결선은 아침 파랑→낮 파랑→오후 금빛→저녁 코랄 4-stop 그라데이션이고,
  각 항목 도트 색은 그 항목 시각의 시간대에서 결정된다.

### GWT-3 — 기존 어포던스 보존 (REQ-WVR-043)
- **Given** 결과 화면의 항목 카드에서
- **When** 재스타일이 적용된 뒤
- **Then** react-icons/lu 아이콘, `Chip`, 드래그 grip, 카카오맵 링크, 대안 "변경" 버튼,
  수정/삭제 컨트롤이 모두 그대로 동작한다.

### GWT-4 — 조건 화면 필드 불변 (REQ-WVR-031)
- **Given** `/trips/new` 여행 조건 폼에서
- **When** mega-card 재스타일이 적용되면
- **Then** 여행 제목·지역·기간·동행자·이동 수단·일정 강도·예산·꼭 포함할 장소·반영할 사항
  9개 필드가 그대로 존재하고, 새 필드는 추가되지 않으며, disabled CTA 사유 문구가 유지된다.

### GWT-5 — 재계획 시트 범위 유지 (REQ-WVR-051)
- **Given** 재계획 바텀시트에서
- **When** 목업 시각으로 재스타일되면
- **Then** 자유서술·꼭 포함할 장소·일정 강도·예산·피하고 싶은 것·이동 최소화 스위치만
  존재하고, 목업의 사유 칩·"지금 일정" 비교 블록(신규 폼 상태)은 추가되지 않는다.

### GWT-6 — 비회귀 게이트 (REQ-WVR-080/081)
- **Given** 리디자인 구현 완료 후
- **When** `pnpm --filter web build`, `tsc --noEmit`, `next lint` 를 실행하면
- **Then** 세 명령 모두 exit 0 이고, 폼 검증/상태 머신/데이터 흐름은 변경되지 않았다.

## §D.2 엣지 케이스
- 다크 모드: `prefers-color-scheme: dark` 에서 토큰 전환이 깨지지 않음(시스템 자동 감지 — 사용자 확정).
- reduced-motion: 애니메이션 비활성 시 레이아웃/가독성 유지.
- 빈 상태: 결과 화면 "해당 일차에 등록된 일정이 없어요" 등 기존 빈 상태 문구 보존.
- 당일치기/1박 등 기간 조합에서 조건 폼 rangeLabel 로직 불변.

## §D.3 품질 게이트 (Definition of Done)
- [ ] AC-WVR-001~080 전부 충족(신규 022/040/052 포함 — 시각 대조 + grep + 게이트).
- [ ] §D.0 대상 7개 파일 하드코딩 hex 합계 = 0 (baseline 148 → 0).
- [ ] `next build` / `tsc --noEmit` / `next lint` exit 0 (증거: 명령 출력).
- [ ] 5개 화면 스크린샷이 각 목업과 시각적으로 대응.
- [ ] `apps/mobile` diff 0.
- [ ] 백엔드/API/스키마 diff 0, 폼 검증·상태 머신 diff 0.
- [ ] `toss-v1.md` v2/부록 갱신 완료.
