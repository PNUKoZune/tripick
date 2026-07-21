/** RN WebView 브리지 핸들 — 웹 → 네이티브로 메시지를 보내는 창구. */
export interface RnWebView {
  postMessage(message: string): void;
}

/**
 * RN WebView 안에서 실행 중이면 브리지 핸들, 브라우저 단독이면 null.
 * `window.ReactNativeWebView` 은 RN 컨테이너가 주입한다.
 */
export function getReactNativeWebView(): RnWebView | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { ReactNativeWebView?: RnWebView }).ReactNativeWebView ?? null;
}
