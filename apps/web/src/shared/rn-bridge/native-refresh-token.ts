import { isTrustedBridgeOrigin } from './bridge-origin';
import { getReactNativeWebView } from './rn-webview';

/**
 * refresh 토큰을 RN 네이티브 SecureStore(iOS Keychain / Android Keystore)에 위임하는 브리지.
 *
 * 브라우저 단독이면 모든 함수가 no-op(또는 undefined)이라 웹 자체 저장(localStorage) 경로가 그대로 동작한다.
 * RN 웹뷰 안에서는 refresh 토큰을 localStorage 에 영속하지 않고 네이티브 보안 저장소에만 둔다 —
 * WebView localStorage 는 검사·탈취 노출면이 넓어 장수(長壽) 자격증명을 두기에 부적합하기 때문.
 * 발급/폐기 HTTP 는 모두 웹이 담당하고, 네이티브는 값의 저장·조회·삭제만 맡는다.
 */

/** RN 웹뷰 컨테이너 안에서 실행 중인지. refresh 저장 전략을 가르는 단일 신호. */
export function isNativeShell(): boolean {
  return getReactNativeWebView() !== null;
}

/** refresh 토큰을 네이티브 SecureStore 에 저장(로그인·토큰 회전 시). */
export function storeNativeRefreshToken(token: string): void {
  getReactNativeWebView()?.postMessage(
    JSON.stringify({ type: 'STORE_REFRESH_TOKEN', token }),
  );
}

/** 네이티브 SecureStore 의 refresh 토큰 제거(로그아웃·탈퇴 시). */
export function clearNativeRefreshToken(): void {
  getReactNativeWebView()?.postMessage(JSON.stringify({ type: 'CLEAR_REFRESH_TOKEN' }));
}

/**
 * `requestNativeRefreshToken` 결과.
 * - string: 저장된 refresh 토큰
 * - null: 네이티브가 "토큰 없음" 을 확정 응답(세션 소실 → 정리 대상)
 * - undefined: 브리지 부재/무응답(타임아웃) — 판정 불가라 세션을 지우면 안 됨
 */
export type NativeRefreshResult = string | null | undefined;

// 브리지는 단방향 postMessage 라 요청-응답을 correlation id 로 상관(correlate)한다.
// 여러 auth 흐름(refresh·logout)이 동시에 물어도 서로의 응답을 뺏지 않도록 Map 으로 다중 대기한다.
type Pending = { resolve: (token: NativeRefreshResult) => void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, Pending>();
let seq = 0;

// 키체인은 AFTER_FIRST_UNLOCK 접근성이라 생체 프롬프트 지연이 없어 왕복은 수십 ms 수준.
// 넉넉히 잡아 순간 부하로 정상 세션이 만료 처리되는 것을 막는다.
const REQUEST_TIMEOUT_MS = 8000;

/**
 * 네이티브 SecureStore 에서 refresh 토큰을 요청한다. 응답(`REFRESH_TOKEN` 메시지)은
 * 아래 모듈 리스너가 correlation id 로 맞춰 이 Promise 를 푼다.
 * 무응답이면 undefined 로 폴백(타임아웃)해 호출부가 세션 파기 대신 재시도로 떨어지게 한다.
 */
export function requestNativeRefreshToken(): Promise<NativeRefreshResult> {
  const rn = getReactNativeWebView();
  if (!rn) return Promise.resolve(undefined);
  const requestId = `rt-${(seq += 1)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(undefined);
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
    rn.postMessage(JSON.stringify({ type: 'REQUEST_REFRESH_TOKEN', requestId }));
  });
}

/** 네이티브 → 웹 `REFRESH_TOKEN` 응답을 해당 요청의 대기 Promise 에 전달. */
function resolvePending(requestId: string, token: string | null): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.resolve(token);
}

// 응답 리스너는 모듈 로드 시점(client 가 import 하는 즉시)에 붙인다 — React mount 타이밍과
// 무관하게 응답을 받아야, 부팅 직후 refresh 요청이 리스너보다 먼저 나가도 유실되지 않는다.
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    // 다른 프레임이 위조한 REFRESH_TOKEN 응답으로 대기 중인 갱신을 망치지 못하게 한다.
    if (!isTrustedBridgeOrigin(event)) return;
    if (typeof event.data !== 'string') return;
    let msg: { type?: string; requestId?: string; token?: string | null } | null = null;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!msg || msg.type !== 'REFRESH_TOKEN' || typeof msg.requestId !== 'string') return;
    resolvePending(msg.requestId, msg.token ?? null);
  });
}
