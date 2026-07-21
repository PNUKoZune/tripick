/**
 * Firebase 웹 앱 설정 — NEXT_PUBLIC_* env 에서 읽는다.
 * 이 값들은 비밀이 아니라 공개 클라이언트 식별자(웹 SDK 표준). 실제 발송 권한은
 * 백엔드 서비스 계정 키가 쥔다.
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
};

export const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? '';

/** 웹 푸시에 필요한 최소 설정이 모두 채워졌는지. 하나라도 비면 초기화 자체를 건너뛴다. */
export function isWebPushConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.projectId &&
      firebaseConfig.messagingSenderId &&
      firebaseConfig.appId &&
      vapidKey,
  );
}

/** 서비스 워커 등록 URL — 설정을 쿼리스트링으로 실어 SW 가 읽게 한다. */
export function serviceWorkerUrl(): string {
  const params = new URLSearchParams({
    apiKey: firebaseConfig.apiKey,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}
