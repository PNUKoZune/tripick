# ESLint 9 Flat Config 워크스페이스 세팅 v1

문서 목적: 설정이 없던 모노레포에 ESLint 9(flat config)를 워크스페이스별로 도입하고, 새 린터가 기존 코드에서 잡은 react-hooks 오류를 해소한 작업을 고정한다. 버전 고정 근거·워크스페이스 분리 구조·오류 처리 원칙(리팩터 vs 사유 명시 disable)을 남긴다.

기준 브랜치: `chore/eslint-setup`
작성일: 2026-07-23

## 1. 배경

`turbo run lint` 와 각 워크스페이스 `lint` 스크립트는 있었으나 실제 ESLint 설정 파일과 의존성이 없었다. 세 앱의 lint 스크립트가 서로 다른 상태(`eslint src --ext`, `next lint`)로 방치돼 있었고, Next 16 은 `next lint` 를 제거했기 때문에 web 은 실행조차 되지 않았다.

- api: `eslint src --ext .ts` — eslint 미설치, 설정 없음
- mobile: `eslint src --ext .ts,.tsx` — `@react-native/eslint-config` 만 있고 eslint·설정 없음
- web: `next lint` — eslint ^9 + eslint-config-next ^16 있으나 설정 파일 없음, 게다가 Next 16 에서 명령 제거
- packages/types·utils: `tsc --noEmit` (순수 타입 패키지)

## 2. 결정 — ESLint 9 고정 (10 아님)

`eslint@latest` 는 **10.7.0** 을 받지만, 생태계가 아직 따라오지 못했다.

- `@react-native/eslint-config` 0.85.2 peer: `^8.0.0 || ^9.0.0` (10 미지원)
- `@babel/eslint-parser`, `eslint-plugin-react`, `eslint-plugin-react-native`, `eslint-plugin-ft-flow` 모두 eslint 10 미지원 peer
- `eslint-config-next` 16 은 `>=9.0.0` 이라 10 도 되지만 Next 16 이 공식 타깃하는 건 9

**결정: `eslint` 를 `^9.39.4` 로 고정.** 함께 `@eslint/js` 도 eslint 메이저와 맞춰 `^9.39.4` 로 고정한다.

⚠️ `@eslint/js` 를 처음 `@latest`(10.0.1)로 깔았더니 v10 recommended 에만 있는 `no-useless-assignment` 규칙이 api 에서 1건 error 를 냈다. 9 로 맞추자 사라졌다 — `@eslint/js` 는 반드시 `eslint` 메이저와 동일 버전.

설치(루트 devDependencies): `eslint@^9.39.4`, `@eslint/js@^9.39.4`, `typescript-eslint@^8.65`, `eslint-config-prettier@^10.1.8`, `globals@^17.7.0`. api·mobile 에는 `eslint` 바이너리만 추가(pnpm 은 선언된 dep 만 `.bin` 에 노출).

## 3. 구조 — 공유 base + 워크스페이스별 config

루트 [`eslint.config.base.mjs`](../../eslint.config.base.mjs) 가 **공통 규칙 객체·ignore 만** 내보내고, 각 워크스페이스가 자기 프리셋 위에 얹는다.

```
eslint.config.base.mjs        # sharedRules · sharedIgnores · baseTsConfig · prettier
apps/api/eslint.config.mjs     # baseTsConfig(typescript-eslint 권장) + node/jest globals
apps/web/eslint.config.mjs     # eslint-config-next flat(core-web-vitals + typescript) + sharedRules
apps/mobile/eslint.config.mjs  # @react-native/eslint-config/flat + sharedRules
```

⚠️ **핵심 제약**: web·mobile 프리셋(next / RN flat)은 이미 `@typescript-eslint` 플러그인을 등록한다. 여기에 base 의 typescript-eslint 를 또 얹으면 flat config 가 "plugin 중복 정의"로 실패한다. 그래서 base 는 typescript-eslint 를 담은 `baseTsConfig`(api 전용)와, 프리셋 위에 얹는 규칙만 담은 `sharedRules` 를 분리해 내보낸다.

- packages/types·utils 는 런타임 코드가 거의 없어 기존 `tsc --noEmit` lint 를 유지(범위 최소화).
- lint 스크립트는 전 워크스페이스 `eslint .` 로 통일(flat config 는 `--ext` 를 쓰지 않는다).

## 4. 함정 — RN flat config 의 ft-flow ESLint 9 크래시

`@react-native/eslint-config` 0.85.2 의 flat config 는 `eslint-plugin-ft-flow@2.0.3`(Flow 타입용)을 번들하는데, 이 플러그인이 **ESLint 9 에서 제거된 `context.getAllComments` 를 호출**해 JS 파일 린트 시 크래시난다(`TypeError: context.getAllComments is not a function`).

이 프로젝트는 Flow 를 쓰지 않고 전부 TypeScript 이므로, mobile config 에서 Flow 규칙 두 개를 끄는 것으로 우회한다.

```js
{ rules: { 'ft-flow/define-flow-type': 'off', 'ft-flow/use-flow-type': 'off' } }
```

추가로 `sharedRules`(= `@typescript-eslint/*`)는 RN 프리셋이 해당 플러그인을 등록하는 TS 파일에만 적용해야 한다(`files: ['**/*.{ts,tsx}']`). JS 파일에 적용하면 "plugin not found" 로 실패한다.

## 5. 오류 처리 — 리팩터 vs 사유 명시 disable

새 린터가 잡은 error 는 대부분 react-hooks 신규 규칙 `set-state-in-effect`(Next 16·RN 0.85 이 error 로 승격). 이를 두 부류로 나눠 처리했다.

| 부류 | 판정 | 처리 | web | mobile |
| --- | --- | --- | --- | --- |
| A | 규칙이 타당(파생 state·스토리지 읽기) | 코드 리팩터 | 10 | 0 |
| B | 정당한 effect 를 규칙이 과탐지 | 사유 명시 `eslint-disable` | 22 | 1 |

### 5.1 부류 A — 리팩터 (web 10건)

- **스토리지 읽기 → `useSyncExternalStore`**: 세션 존재 여부를 마운트 후 읽던 `setHasSession(...)` 패턴을 [`useHasSession`](../../apps/web/src/entities/session/lib/use-has-session.ts)(구독 없는 `useSyncExternalStore`, 서버 스냅샷 `false`)로 대체. 하이드레이션 불일치까지 함께 해소. `useActiveTrip`·`useInboxUnread` 적용.
- **파생 state 동기화 → 렌더 단계 조정**: 입력(`items`·`tripId`·`permission`·`day`·`dayCount`·`value`)이 바뀔 때 로컬 state 를 맞추던 effect 를, 이전 값과 비교하는 **렌더 단계 setState**(React 공식 "adjusting state on prop change")로 이동. 조정 후 조건이 거짓이 되어 무한 루프가 없다. 대상: editable-timeline, replan-toast, location-permission-banner, inbox-view, planner-view(day 보정), trip-create, use-alternative-controller(itemId 리셋), inline-editable-text.

### 5.2 부류 B — 사유 명시 disable (web 22건 · mobile 1건)

setState 가 진짜 side-effect 의 일부라 effect 가 맞는 경우. 각 위치에 `// eslint-disable-next-line react-hooks/set-state-in-effect -- <사유>` 를 달았다.

- 애니메이션(rAF phase 전환 — bottom-sheet), 비동기 SDK·소켓 셋업(planner-map · use-replan-subscription · use-current-location · destination-map-picker), `createObjectURL` 미리보기(cleanup 동반), 리다이렉트 동반(session-guard), 콜백 URL 파싱·스토리지 시드(kakao-callback · preference-setup-* · planner-view 사이드바), 모달 열 때 필드 리셋(replan-modal · alternative-sheet · item-editor-sheet)
- `react-hooks/refs` 1건(use-report-live-location): 최신 위치를 ref 로 미러(하트비트가 렌더와 무관하게 읽음)
- mobile `exhaustive-deps` 1건(App.tsx `setupFcm`): `dispatchNotificationTap` 이 `postToWeb`(webviewRef)만 쓰는 안정 함수라, 재구독을 막으려 빈 deps 를 의도적으로 유지

부류 B 를 disable 로 둔 이유: 정당한 effect 를 억지로 리팩터하면(key remount·render 조정) 애니메이션·소켓·SSR 로직에 회귀 위험이 크다. 규칙은 error 로 유지하되 예외만 사유와 함께 국소적으로 연다.

## 6. 검증

- 전 워크스페이스 `eslint .` **0 error**
  - api: 0 error (warning 141 — 대부분 `no-explicit-any`, warn 으로 둠)
  - web: 0 error (warning 3 — 기존 `exhaustive-deps`)
  - mobile: 0 error
- `tsc --noEmit` — web·mobile 모두 통과
- 리팩터한 파일은 기존 effect 의 트리거 조건·가드를 그대로 옮겨 동작 동일성 유지

## 7. 커밋

- `chore(lint): ESLint 9 flat config 워크스페이스 세팅` — 설치·설정만
- `fix(lint): react-hooks set-state-in-effect 오류 해소 (web 32·mobile 1)` — 코드 수정
