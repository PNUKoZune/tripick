import { getReactNativeWebView } from './rn-webview';

/**
 * refresh 토큰을 RN 네이티브 SecureStore(iOS Keychain / Android Keystore)에 위임하는 브리지.
 *
 * 브라우저 단독이면 모든 함수가 no-op(또는 null)이라 웹 자체 저장(localStorage) 경로가 그대로 동작한다.
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

// 브리지는 단방향 postMessage 라 요청-응답을 pending resolver 로 상관(correlate)한다.
// refresh 토큰은 하나뿐이라 단일 pending 으로 충분하다.
let pending: { resolve: (token: string | null) => void; timer: ReturnType<typeof setTimeout> } | null =
  null;

const REQUEST_TIMEOUT_MS = 3000;

/**
 * 네이티브 SecureStore 에서 refresh 토큰을 요청한다. 응답(`REFRESH_TOKEN` 메시지)은
 * rn-bridge 수신부가 `resolveNativeRefreshToken` 으로 넘겨 이 Promise 를 푼다.
 * 네이티브 부재/무응답이면 null 로 폴백(타임아웃)해 refresh 흐름이 만료 처리로 안전하게 떨어진다.
 */
export function requestNativeRefreshToken(): Promise<string | null> {
  const rn = getReactNativeWebView();
  if (!rn) return Promise.resolve(null);
  // 직전 요청이 아직 대기 중이면 정리한다(중복 요청 방지).
  if (pending) {
    clearTimeout(pending.timer);
    pending.resolve(null);
    pending = null;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending = null;
      resolve(null);
    }, REQUEST_TIMEOUT_MS);
    pending = { resolve, timer };
    rn.postMessage(JSON.stringify({ type: 'REQUEST_REFRESH_TOKEN' }));
  });
}

/** 네이티브 → 웹 `REFRESH_TOKEN` 응답 처리. rn-bridge 수신부가 호출. */
export function resolveNativeRefreshToken(token: string | null): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  const { resolve } = pending;
  pending = null;
  resolve(token);
}
