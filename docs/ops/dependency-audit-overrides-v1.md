# 의존성 취약점 정리 — pnpm overrides (v1)

> 2026-08-27 보안 점검의 의존성 항목. `pnpm audit --prod` 84건 → **2건**.

## 요약

| 단계 | 남은 건수 | 내용 |
|---|---|---|
| 시작 | 84 (critical 2 · high 42) | |
| Next.js 16.3.3 | 55 | 프록시 우회·SSRF (별도 커밋) |
| axios·typeorm 락파일 | 42 | 선언 범위가 이미 허용 — 락파일만 멈춰 있었음 |
| overrides 21개 | 2 | transitive 일괄 |

남은 2건은 **패치가 존재하지 않는다** (`image-size`, `Patched versions: <0.0.0`).

## 직접 의존성 — 범위는 열려 있었고 락파일만 멈춰 있었다

- `axios` 1.16.0 → **1.20.0** (10건). 카카오·기상청·KTO·네이버·ODsay·LLM 호출이 전부 이걸 탄다.
  high 는 Node HTTP adapter 가 상속된 proxy 설정을 쓸 수 있는 문제
- `typeorm` 0.3.28 → **0.3.31** (2건). 하나는 `migration:generate` 템플릿 리터럴 코드 인젝션(개발 도구)

둘 다 선언이 `^1.16.0`·`^0.3.28` 이라 패치 버전을 이미 허용했다 — **CI 의 새 install 은 이미 새 버전을 받고 있었고 락파일만 옛 버전에 묶여 있었다.**

### ⚠️ axios 1.20 브레이킹: `params` 가 `unknown`

`AxiosRequestConfig.params` 타입이 `any` → `unknown` 으로 바뀌어 테스트가 컴파일 실패했다
([route.helper.spec.ts](../../apps/api/test/planner/helpers/route.helper.spec.ts) 의 `options?.params.origin`).

**`pnpm turbo run typecheck` 는 이걸 못 잡는다** — API 의 `tsc --noEmit` 은 `src` 만 보고, 테스트는
ts-jest 가 실행 시점에 컴파일한다. 즉 **타입체크가 초록인데 테스트 스위트가 로드에 실패**한다.
의존성을 올릴 때는 typecheck 만 보지 말고 `test` 까지 돌릴 것.

## overrides 작성 규칙

### 1. 타깃은 **반드시 캐럿으로 같은 메이저에 묶는다**

`pnpm audit --fix` 가 만들어 주는 타깃은 `">=7.29.6"` 같은 열린 범위다. 그러면 pnpm 이
**다음 메이저까지** 올린다 — 실제로 `@babel/core: ">=7.29.6"` 이 **8.0.1** 을 끌어와
`@react-native/babel-preset`(^7 요구)이 깨졌다:

```
Parsing error: [BABEL] Requires Babel "^7.0.0-0", but was loaded with "8.0.1"
```

`"^7.29.6"` 으로 바꾸면 7.x 에 머문다. 모든 항목을 이 형태로 둔다.

### 2. 셀렉터는 **취약 범위로 좁힌다** (메이저 혼재 때문)

트리에 같은 패키지의 여러 메이저가 공존한다:

- `ws` — 6.2.3 / 7.5.10 / 8.18.3 (RN CLI·Metro·socket.io 가 각각)
- `brace-expansion` — 1.1.14 / 2.1.0 / 5.0.5
- `js-yaml` — 3.14.2 / 4.1.1

그래서 `"ws": "^8.21.0"` 처럼 **이름만 쓰면 RN 의 ws@6/7 까지 8.x 로 끌어올려** Metro 가 깨진다.
`"ws@>=8.0.0 <8.21.0": "^8.21.0"` 형태로 라인별로 나눠 쓴다.

### 3. `pnpm audit --fix` 결과는 그대로 쓰지 말고 접는다

advisory 한 건당 한 줄을 쌓아서 같은 패키지에 겹치는 항목이 39개까지 늘어난다
(`fast-uri` 5줄, `brace-expansion` 7줄). 라인별로 가장 높은 타깃 하나만 남겨 21개로 접었다.

### 4. 락파일이 옛 해석을 붙들면 되돌려서 다시 해석시킨다

override 를 고쳐도 이미 기록된 해석이 남는다(babel 8.0.1 이 override 를 지운 뒤에도 남았다).
`git checkout -- pnpm-lock.yaml` 후 `pnpm install` 로 baseline 에서 다시 해석시키면 정리된다.

## 성격별 분류

override 블록은 이 순서로 묶어 뒀다.

**런타임 — 우리가 실제로 그 코드 경로를 쓴다**

- `multer` <2.2.0 → high DoS. **multipart 업로드를 실제로 받는다**(프로필 이미지, 취향 사진 3장×10MB).
  `@nestjs/platform-express@11` 이 multer 2.1.1 을 물고 있다 — 12 는 Express 5 라 메이저 마이그레이션이므로 override 로 덮었다
- `ws` 8.x → high 메모리 고갈 DoS. Socket.IO 게이트웨이 운영 중
- `socket.io-parser`, `body-parser`, `qs`

**트리에 실려 있지만 우리가 호출하지 않는 코드**

- `websocket-driver`(critical) — `firebase-admin > @firebase/database`. Firebase RTDB 클라이언트이고 우리는 FCM 만 쓴다
- `protobufjs`, `@grpc/grpc-js`, `uuid`, `joi`, `form-data` — firestore·storage 체인

**웹 번들**

- `dompurify` — `jspdf` 가 PDF 내보내기에서 sanitize 에 쓴다
- `fast-uri` — `@sentry/nextjs` 체인

**빌드·개발 도구 (앱 번들에 안 들어감)**

- `shell-quote`(critical), `fast-xml-parser`, `ws@6/7`, `@babel/core` — RN CLI·Metro·codegen
- `js-yaml` — `@nestjs/swagger` (비프로덕션에서만 서빙)

## 남은 2건 — 패치 없음

```
image-size <=2.0.2   Patched versions: <0.0.0
  apps/mobile > @notifee/react-native > react-native > @react-native/community-cli-plugin > ...
```

ICNS·JXL/HEIF 파서 DoS. **상류에 수정본이 없다.** RN CLI 개발 도구 경로라 앱 번들에
들어가지 않고, 우리가 이 파서에 파일을 흘리는 코드도 없다. react-native 를 올려
CLI 체인이 바뀔 때 다시 확인한다.

## 확인 방법

```bash
pnpm audit --prod                       # 2건(image-size)만 남아야 한다
pnpm turbo run build typecheck lint test  # override 가 무엇을 깨뜨렸는지는 여기서만 보인다
pnpm --filter @tripick/mobile lint      # babel 메이저 사고는 여기서 먼저 터진다
```
