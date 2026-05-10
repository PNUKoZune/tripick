# Tripick independent QA — feature/tripick-web-v1-ux

- Date: 2026-05-08
- Branch: `feature/tripick-web-v1-ux`
- Local SHA: `ddec90068b02cc396d4febd9919bd801d2a1700c`
- Remote SHA: `ddec90068b02cc396d4febd9919bd801d2a1700c`
- Push status: `0 0` (local/remote divergence 없음)
- QA target: `/tmp/tripick`

## Overall verdict
- FAIL

## What was verified
1. Happy path reproducibility: landing → 취향 입력 → 여행 조건 → 결과 → 재계획
2. 320 / 360 / 390 / 430 / 768 / 1440 responsive typography / overflow 여부
3. Pretendard / CTA 위계 / 정보 구조 / Toss-style 일관성
4. 실패 시 오류 문구 / 재시도 UX / raw `Internal Server Error` 노출 여부
5. branch / local SHA / remote SHA / push 상태

## Reproduction summary

### A. Happy path / replan API reproducibility: PASS
직접 API로 데모 세션 생성, 취향 저장, 여행 생성, itinerary 조회, waiting 기반 재계획까지 재현했습니다.

- `POST /api/v1/auth/demo` → 200
- `PUT /api/v1/preferences` → 200
- `POST /api/v1/trips` → 201
- `GET /api/v1/trips/:id/itinerary` → 200
- `POST /api/v1/alternative/waiting` → 201
- 재계획 후 itinerary 변경 확인: PASS

검증 결과 요약:
- trip id: `ee383837-1309-4493-b7a3-7f1691de7b9a`
- 변경 전 day1 첫 2개: `광안리 브런치 카페`, `기장 해산물 식당`
- 변경 후 day1 첫 2개: `기장 해산물 식당`, `흰여울문화마을 (waiting 대응)`

### B. Responsive / typography baseline: PASS
현재 생성돼 있는 QA artifact 기준으로 320/360/390/430/768/1440 전 breakpoint에서 overflowX=false 였고, fontFamily가 Pretendard stack으로 유지됐습니다.

`/tmp/tripick/tmp/qa-logs/tripick-flow-qa.json` 기준:
- 320: h1 28px / CTA 16px / overflowX false
- 360: h1 28px / CTA 16px / overflowX false
- 390: h1 28px / CTA 16px / overflowX false
- 430: h1 30.1px / CTA 16px / overflowX false
- 768: h1 37.6px / CTA 16px / overflowX false
- 1440: h1 37.6px / CTA 16px / overflowX false

### C. Raw `Internal Server Error` user-facing 노출: FAIL (blocking)
실제 fallback error handling 자체는 `apps/web/src/lib/api.ts` 에서 500 / `Internal Server Error` 를 사용자용 문구로 치환하도록 구현돼 있습니다.

하지만 결과 화면 본문에 아래 문구가 정적으로 노출됩니다.
- file: `apps/web/src/widgets/trip-planner-demo/ui/trip-planner-demo-page.tsx:623`
- text: `Internal Server Error 원문 대신 제품 톤의 상태 메시지와 재시도 UX로 마감합니다.`

즉, 실제 서버 에러 payload가 그대로 뜨는 버그라기보다, raw 에러 용어 자체가 제품 화면 카피로 노출되는 상태입니다. 사용자 기준에서는 동일하게 FAIL 입니다.

### D. Internal implementation notes exposed in product UI: FAIL (blocking)
결과 화면 하단에 내부 구현/정리 메모가 그대로 노출됩니다.

Evidence:
- `apps/web/src/widgets/trip-planner-demo/ui/trip-planner-demo-page.tsx:755-763`
- 노출 문구:
  - `이번 정리 기준`
  - `기본 본문 폭을 520px 이하로 고정해 모바일 리듬을 유지`
  - `헤드라인·카드·CTA를 Pretendard 기준 위계로 재정렬`
  - `결과 화면 CTA는 sticky 대신 본문 맥락 안에서만 노출`
  - `app/page는 위젯 엔트리만 남기고 구현은 widget 경계로 이동`

이 내용은 사용자-facing 카피가 아니라 개발/구현 메모에 가깝고, 제품 완성도를 직접 해칩니다.

### E. CTA hierarchy / info structure / Toss-style consistency: FAIL (non-blocking visual, but major)
Vision review 기준:
- 320 모바일 랜딩은 카드/설명량이 많고 primary CTA가 늦게 등장합니다.
- 결과 화면도 일정 카드 외에 가이드/정리 메모 카드가 같이 노출되어 행동 위계가 흐려집니다.
- 레이아웃 붕괴나 overflow 같은 치명적 시각 버그는 없지만, Toss-style 기준의 절제된 정보 구조와는 거리가 있습니다.

## Blocking issues
1. 결과 화면에 raw `Internal Server Error` 용어가 정적 카피로 노출됨
   - source: `apps/web/src/widgets/trip-planner-demo/ui/trip-planner-demo-page.tsx:623`
   - severity: blocking
2. 결과 화면에 내부 구현 메모/정리 기준이 그대로 노출됨
   - source: `apps/web/src/widgets/trip-planner-demo/ui/trip-planner-demo-page.tsx:755-763`
   - severity: blocking

## Non-blocking issues
1. 320px 모바일 랜딩에서 CTA가 fold 아래로 밀리고 설명 카드가 많아 첫 행동 유도가 약함
2. 결과 화면의 카드 수와 설명량이 많아 스캔성이 떨어짐
3. CTA / 가이드 / 내부 메모 카드가 비슷한 위계로 보여 행동 우선순위가 흐려짐

## PASS / FAIL checklist
- Flow reproducible: PASS
- Replan success reproducible: PASS
- Responsive overflow check: PASS
- Pretendard stack applied: PASS
- Raw `Internal Server Error` hidden from product UI: FAIL
- Failure / retry UX copy polished for product use: FAIL
- Internal implementation notes hidden from product UI: FAIL
- branch/local SHA/remote SHA/push status verified: PASS

## Evidence paths
- API log: `/tmp/tripick/tmp/qa-logs/api.log`
- Web log: `/tmp/tripick/tmp/qa-logs/web.log`
- Flow artifact JSON: `/tmp/tripick/tmp/qa-logs/tripick-flow-qa.json`
- Landing 320 screenshot: `/tmp/tripick/tmp/qa-logs/screenshots/landing-320.png`
- Result screenshot: `/tmp/tripick/tmp/qa-logs/screenshots/result-desktop.png`
- Replan error screenshot: `/tmp/tripick/tmp/qa-logs/screenshots/replan-error-desktop.png`
- Current verification screenshot copies: `/tmp/tripick/docs/verification/screenshots-2026-05-08-current/`

## Notes
- 로컬 web(3000) / api(4000) / postgres(5432) / redis(6379) 는 검증 시점에 live 상태였습니다.
- repo working tree 는 clean 하지 않았습니다. 확인 시점 상태:
  - modified: `apps/web/next-env.d.ts`
  - untracked: `docs/verification/`, `tmp/`
- 이는 현재 QA 산출물/로컬 생성물 영향으로 보이며, branch/local/remote SHA 일치 자체는 유지됩니다.
