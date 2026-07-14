/**
 * RN 브릿지로 등록한 마지막 FCM 토큰을 세션 단위로 기억한다.
 * - rn-bridge: 동일 토큰 중복 등록 방지
 * - 로그아웃: 어떤 토큰을 서버에서 해제할지 알아내기 위함
 */
const LAST_FCM_KEY = 'tripick.fcm.lastToken';

export function getLastFcmToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem(LAST_FCM_KEY);
}

export function setLastFcmToken(token: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(LAST_FCM_KEY, token);
}

export function clearLastFcmToken(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(LAST_FCM_KEY);
}
