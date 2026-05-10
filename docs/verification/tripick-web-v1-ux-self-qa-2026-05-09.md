# Tripick self-QA — feature/tripick-web-v1-ux

- Date: 2026-05-09
- Branch: `feature/tripick-web-v1-ux`
- Local SHA: `f1dd5dbf193b6b535cdbe587f6ff8394bf96bf71`
- Remote SHA: `f1dd5dbf193b6b535cdbe587f6ff8394bf96bf71`
- Last push result: `success: ddec900..f1dd5db HEAD -> feature/tripick-web-v1-ux`
- QA target: `/tmp/tripick`

## Overall verdict
- PASS

## What was verified
1. landing → 취향 입력 → 여행 조건 → 결과 → 재계획 happy path 재현
2. 320 / 360 / 390 / 430 / tablet(768) / desktop(1280) 반응형 타이포 및 overflow 여부
3. Pretendard 적용 여부
4. Toss 스타일 기준의 정보 위계 / CTA 우선순위 / 카드 리듬
5. raw `Internal Server Error` 및 내부 구현 메모 노출 여부
6. 현재 SHA 기준 실행 절차(`web build`, API demo flow) 재현 가능 여부

## Reproduction summary

### A. 실행 절차 재현: PASS
- `pnpm --filter @tripick/web build` 통과
- demo API flow 재현 성공
  - `POST /api/v1/auth/demo` → 200
  - `PUT /api/v1/preferences` → 200
  - `POST /api/v1/trips` → 201
  - `GET /api/v1/trips/:id/itinerary` → 200
  - `POST /api/v1/alternative/waiting` → 201
  - 재계획 후 itinerary 변경 확인: PASS
- 확인된 trip id: `450c8d1c-6d73-4991-a17f-b407eda5d115`
- 변경 전 day1 첫 2개: `광안리 브런치 카페`, `기장 해산물 식당`
- 변경 후 day1 첫 2개: `기장 해산물 식당`, `흰여울문화마을 (waiting 대응)`

### B. Pretendard 적용: PASS
- `apps/web/src/app/layout.tsx` 에 Pretendard CDN 로드 확인
- `apps/web/src/app/globals.css` 에 body font-family 첫 우선순위가 `Pretendard` 로 지정됨
- UI QA 스크립트 기준 6개 viewport 전부 computed `fontFamily` 에 Pretendard stack 확인

### C. 반응형 / 줄바꿈 / overflow: PASS
- 6개 viewport 모두 landing/result 화면에서 `overflowX=false`
- hero headline / section title / step title / result card title이 잘리지 않고 유지됨
- 주요 관찰
  - 320: landing hero 2줄, result hero 2줄, day step title 1줄
  - 360: landing hero 2줄, result hero 1줄
  - 390: result 첫 카드 title 2줄 1건 있었지만 잘림/겹침 없이 읽힘
  - 430 / tablet / desktop: headline, section title, CTA 가독성 안정적

### D. 제품 흐름 / Toss 스타일 정렬: PASS with minor notes
- landing → 입력 → 결과 → 재계획이 단일 컬럼 제품 흐름으로 일관되게 이어짐
- 결과 hero, 요약 카드, day 카드, 재계획 섹션, 단일 primary CTA 순서가 명확함
- 과한 장식/gradient hero image 없이 카드 중심 리듬 유지
- minor notes
  - 320 랜딩은 설명 문구와 보조 카드가 조금 많아 첫 CTA 임팩트가 아주 강하진 않음
  - desktop은 모바일 단일 컬럼 리듬을 잘 유지하지만 세로 길이가 길어 중반 이후 반복감이 있음

### E. raw error / 내부 메모 노출: PASS
- source 검색 기준 `Internal Server Error`, `이번 정리 기준` 문자열이 현재 web source/user-facing DOM 에서 제거됨
- UI QA 스크립트 기준 재계획 전/후 모든 viewport 에서 forbidden text 미검출
- request failure / page error / console error 없음 (`React DevTools`, `[HMR] connected` 로그만 존재)

## Screen-by-screen notes

### 320
- PASS
- landing hero / section title 2줄 유지, CTA 가독성 문제 없음
- result hero 는 2줄이지만 자연스럽고 overflow 없음
- blocking 없음
- non-blocking: 랜딩 상단 설명 밀도가 조금 높음

### 360
- PASS
- landing/result 모두 가장 안정적인 모바일 리듬
- blocking/non-blocking 없음

### 390
- PASS
- result 첫 카드 title 2줄 1건 있었지만 카드 폭 안에서 정상 렌더링
- blocking 없음
- non-blocking: 일정 item title 길이에 따라 2줄 가능성 있음

### 430
- PASS
- hero, section title, CTA 모두 안정적
- blocking/non-blocking 없음

### tablet (768)
- PASS
- 단일 컬럼 유지, 카드 위계 명확
- blocking 없음
- non-blocking: 모바일 중심 레이아웃 특성상 좌우 활용은 제한적

### desktop (1280)
- PASS
- 모바일 단일 컬럼 컨셉 유지, 시각 붕괴 없음
- blocking 없음
- non-blocking: 섹션이 많아 스크롤 길이가 길게 느껴질 수 있음

## Blocking issues
- 없음

## Non-blocking issues
1. 320 랜딩에서 설명/보조 카드 밀도가 조금 높아 첫 CTA 집중도가 약간 분산됨
2. 390 결과 카드 일부 title 이 2줄까지 갈 수 있음
3. desktop 에서 단일 컬럼 리듬은 유지되지만 세로 길이로 인한 반복감이 있음

## PASS / FAIL checklist
- Flow reproducible: PASS
- Replan success reproducible: PASS
- Web build reproducible: PASS
- Responsive overflow check: PASS
- Pretendard stack applied: PASS
- Toss-style CTA / card rhythm broadly aligned: PASS
- Raw `Internal Server Error` hidden from product UI: PASS
- Internal implementation notes hidden from product UI: PASS
- branch/local SHA/remote SHA verified: PASS

## Evidence paths
- Report: `/tmp/tripick/docs/verification/tripick-web-v1-ux-self-qa-2026-05-09.md`
- UI QA summary JSON: `/tmp/tripick/tmp/qa-2026-05-09-selfqa/ui-qa.json`
- UI QA runner log: `/tmp/tripick/tmp/qa-2026-05-09-selfqa/ui-qa-run.log`
- API flow JSON: `/tmp/tripick/tmp/qa-2026-05-09-selfqa/api-flow.json`
- Web build log: `/tmp/tripick/tmp/qa-2026-05-09-selfqa/web-build.log`
- Screenshots dir: `/tmp/tripick/tmp/qa-2026-05-09-selfqa/screenshots/`
  - landing: `landing-320.png`, `landing-360.png`, `landing-390.png`, `landing-430.png`, `landing-tablet.png`, `landing-desktop.png`
  - result: `result-320.png`, `result-360.png`, `result-390.png`, `result-430.png`, `result-tablet.png`, `result-desktop.png`
  - replan: `replan-320.png`, `replan-360.png`, `replan-390.png`, `replan-430.png`, `replan-tablet.png`, `replan-desktop.png`

## Status handoff
- branch: `feature/tripick-web-v1-ux`
- local SHA: `f1dd5dbf193b6b535cdbe587f6ff8394bf96bf71`
- remote SHA: `f1dd5dbf193b6b535cdbe587f6ff8394bf96bf71`
- last push result: `success: ddec900..f1dd5db HEAD -> feature/tripick-web-v1-ux`
- blocker: none
- next action: PM/owner 가 바로 검토하거나 merge/deploy 판단으로 넘겨도 되는 상태
