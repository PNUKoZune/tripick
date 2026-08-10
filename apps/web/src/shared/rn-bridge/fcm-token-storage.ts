/**
 * RN 브릿지로 등록한 마지막 FCM 토큰을 세션 단위로 기억한다.
 * - rn-bridge: 동일 토큰 중복 등록 방지
 * - 로그아웃: 어떤 토큰을 서버에서 해제할지 알아내기 위함
 */
const LAST_FCM_KEY = 'tripick.fcm.lastToken';
/**
 * 세션이 없을 때(로그인 전) 도착한 토큰을 잠시 보관. 로그인 완료 시 flush 해서 등록한다.
 * 안 그러면 첫 로그인 유저의 토큰이 그 세션 동안 등록되지 못하고 유실된다.
 */
const PENDING_FCM_KEY = 'tripick.fcm.pendingToken';

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

export function getPendingFcmToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem(PENDING_FCM_KEY);
}

export function setPendingFcmToken(token: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(PENDING_FCM_KEY, token);
}

export function clearPendingFcmToken(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(PENDING_FCM_KEY);
}
