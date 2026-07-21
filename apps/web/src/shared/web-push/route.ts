/**
 * 푸시 data payload → 이동할 경로. 백엔드는 data 에 category(=type) 와 tripId 를 싣는다.
 * - friend_request·trip_invite: 수락/거절 액션이 인박스 가상·영속 row 에 있으므로 /inbox
 * - 여행 관련(replan·weather·crowd·arrival·reminder·general): tripId 있으면 해당 여행, 없으면 인박스
 *
 * 서비스 워커(firebase-messaging-sw.js)에는 앱 코드를 import 할 수 없어 같은 규칙이 복제돼 있다.
 * 규칙을 바꾸면 SW 쪽도 함께 고친다.
 */
export function routeForNotification(data?: Record<string, string>): string | null {
  if (!data) return null;
  const category = data.category ?? data.type;
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
