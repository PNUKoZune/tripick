import type { MessagePayload } from 'firebase/messaging';

import { isNativeShell } from '@/shared/rn-bridge/native-refresh-token';
import { firebaseConfig, isWebPushConfigured, serviceWorkerUrl, vapidKey } from './config';

/**
 * firebase SDK(app+messaging, 약 130KB)는 여기서만 쓰는데 정적 import 면 `<WebPush />` 가
 * providers 에 상시 마운트돼 있어 **모든 라우트** 첫 로드에 실린다. 실제로 필요한 건
 * 웹 푸시가 켜진 브라우저뿐이고 RN 웹뷰·env 미설정·미지원 브라우저는 아래 값싼 가드에서
 * 그대로 빠지므로, 그 가드를 통과한 뒤에 동적으로 받는다. 모듈 캐시는 번들러가 쥔다.
 */
async function loadFirebase() {
  const [app, messaging] = await Promise.all([
    import('firebase/app'),
    import('firebase/messaging'),
  ]);
  return { ...app, ...messaging };
}

/**
 * 웹 푸시 지원·활성 조건. 하나라도 어긋나면 조용히 건너뛴다.
 * - RN WebView 안: 네이티브가 FCM 을 잡으므로 웹은 손대지 않는다(토큰 이중 등록 방지).
 * - env 미설정 / SSR / SW·Notification 미지원 브라우저: no-op.
 */
async function canUseWebPush(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (isNativeShell()) return false;
  if (!isWebPushConfigured()) return false;
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;
  try {
    const { isSupported } = await loadFirebase();
    return await isSupported();
  } catch {
    return false;
  }
}

async function ensureMessaging() {
  const { getApp, getApps, getMessaging, initializeApp } = await loadFirebase();
  return getMessaging(getApps().length ? getApp() : initializeApp(firebaseConfig));
}

/**
 * 알림 권한 확보 + FCM 웹 토큰 발급. 다음이면 null 을 반환한다(호출자는 조용히 무시):
 * 미지원 환경 · 권한 거부 · 토큰 발급 실패.
 * 권한이 `default` 면 브라우저 권한 프롬프트를 띄운다.
 */
export async function requestWebPushToken(): Promise<string | null> {
  if (!(await canUseWebPush())) return null;

  if (Notification.permission === 'denied') return null;
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') return null;
  }

  try {
    const registration = await navigator.serviceWorker.register(serviceWorkerUrl());
    // getToken 은 PushManager 구독을 위해 active 워커를 요구한다. register 직후엔 아직
    // installing 상태일 수 있어(→ 'no active Service Worker'), activated 될 때까지 기다린다.
    await waitForActivation(registration);
    const { getToken } = await loadFirebase();
    const messaging = await ensureMessaging();
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    return token || null;
  } catch (err) {
    console.warn('[web-push] token 발급 실패:', err);
    return null;
  }
}

/** 서비스 워커가 active 될 때까지 대기. 이미 active 면 즉시 반환. */
function waitForActivation(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active) return Promise.resolve();
  const worker = registration.installing ?? registration.waiting;
  if (!worker) return navigator.serviceWorker.ready.then(() => undefined);
  return new Promise<void>((resolve) => {
    const check = () => {
      if (worker.state !== 'activated') return;
      worker.removeEventListener('statechange', check);
      resolve();
    };
    worker.addEventListener('statechange', check);
    check(); // 리스너 부착 직전에 이미 activated 됐을 수 있는 레이스 방어.
  });
}

/**
 * 포그라운드 수신 구독. 탭이 열려 있을 때 도착한 푸시는 OS 알림이 뜨지 않으므로
 * 여기서 콜백을 받아 인박스 invalidate 등 앱 상태만 갱신한다.
 * 반환값은 구독 해제 함수(미지원이면 no-op).
 */
export async function onForegroundPush(
  handler: (payload: MessagePayload) => void,
): Promise<() => void> {
  if (!(await canUseWebPush())) return () => {};
  try {
    const { onMessage } = await loadFirebase();
    const messaging = await ensureMessaging();
    return onMessage(messaging, handler);
  } catch {
    return () => {};
  }
}
