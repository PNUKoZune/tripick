/**
 * 네이티브 브리지 메시지의 출처 검증.
 *
 * RN 이 보내는 메시지는 `injectJavaScript` 로 **이 문서 안에서** `window.postMessage` 를
 * 호출하는 방식이라, 도착한 이벤트의 `origin` 은 항상 이 페이지 자신의 오리진이다.
 * 그래서 same-origin 만 통과시켜도 네이티브 경로는 하나도 막히지 않는다.
 *
 * 검사가 없으면 `window.addEventListener('message')` 는 **다른 창·프레임이 보낸 메시지도
 * 똑같이 받는다.** 프레임 방어가 없던 동안엔 공격자 페이지가 이 앱을 iframe 으로 띄우고
 * `FCM_TOKEN` 을 던져 피해자 계정에 자기 기기 토큰을 등록시킬 수 있었다(푸시 수신 탈취).
 * `REFRESH_TOKEN` 응답 위조로 세션 갱신을 죽이는 것도 같은 통로였다.
 *
 * `event.origin` 이 빈 문자열('null' 오리진 — sandboxed iframe·data: 문서)인 경우도
 * 여기서 함께 걸러진다.
 */
export function isTrustedBridgeOrigin(event: MessageEvent): boolean {
  if (typeof window === 'undefined') return false;
  return event.origin === window.location.origin;
}
