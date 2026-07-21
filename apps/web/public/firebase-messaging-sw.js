/**
 * Firebase Cloud Messaging 서비스 워커 — 브라우저 단독(RN 컨테이너 밖) 사용자의 백그라운드 푸시 수신.
 * 탭이 닫혀 있거나 백그라운드일 때 이 워커가 알림을 띄우고, 클릭 시 해당 화면으로 라우팅한다.
 *
 * 설정은 등록 URL 쿼리스트링으로 주입한다 — 서비스 워커는 빌드 타임 env(process.env)를
 * 못 읽으므로, 메인 스레드가 register('/firebase-messaging-sw.js?apiKey=…') 로 넘겨준다.
 * compat SDK 는 CDN 에서 importScripts — npm firebase 버전과 독립적으로 동작한다.
 */
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js');

const params = new URL(self.location).searchParams;
const firebaseConfig = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

/**
 * 푸시 data payload → 이동 경로. 메인 스레드 rn-bridge.tsx 의 routeForNotification 과 동일 규칙
 * (서비스 워커는 앱 코드를 import 할 수 없어 불가피하게 중복). 규칙 변경 시 양쪽을 함께 고친다.
 */
function routeForNotification(data) {
  const category = data.category || data.type;
  const tripId = data.tripId;
  switch (category) {
    case 'friend_request':
    case 'trip_invite':
      return '/inbox';
    case 'replan_ready':
    case 'weather_alert':
    case 'crowd_alert':
    case 'arrival_alert':
    case 'trip_reminder':
    case 'general':
      return tripId ? `/planner?tripId=${tripId}` : '/inbox';
    default:
      return '/inbox';
  }
}

if (firebaseConfig.projectId) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  // 백그라운드 수신 — notification 페이로드는 브라우저가 자동으로 띄우기도 하지만,
  // data-only 메시지·일관된 클릭 데이터를 위해 직접 표시한다.
  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || payload.data?.title || '트리픽';
    const body = payload.notification?.body || payload.data?.body || '';
    self.registration.showNotification(title, {
      body,
      tag: payload.data?.tripId || undefined,
      data: payload.data || {},
    });
  });
}

// 알림 클릭 → 열린 탭이 있으면 포커스·라우팅, 없으면 새 창.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const path = routeForNotification(data);
  const targetUrl = new URL(path, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          // 이미 열린 탭에 라우팅 지시를 보내고 포커스.
          client.postMessage({ type: 'NOTIFICATION_TAP', data });
          if ('navigate' in client) client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
