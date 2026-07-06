import { AppRegistry } from 'react-native';
import notifee, { AndroidImportance } from '@notifee/react-native';
import App from './src/App';
import { name as appName } from './app.json';

/**
 * 백그라운드 / 종료 상태 메시지 핸들러.
 * RN App 컴포넌트 마운트 전(=index.js)에서 등록해야 Firebase 가 인식한다.
 * 'notification' 필드가 있으면 OS 가 자동 표시, 'data-only' 페이로드는 notifee 로 직접 표시.
 *
 * v22+ modular API 사용. (namespaced messaging().setBackgroundMessageHandler 는 deprecated)
 */
if (!__DEV__) {
  try {
    const { getApps } = require('@react-native-firebase/app');
    if (getApps().length > 0) {
      const { getMessaging, setBackgroundMessageHandler } = require('@react-native-firebase/messaging');
      setBackgroundMessageHandler(getMessaging(), async (remoteMessage) => {
        const { notification, data } = remoteMessage ?? {};
        if (notification?.title || notification?.body) return;

        await notifee.displayNotification({
          title: data?.title ? String(data.title) : 'TriPick',
          body: data?.body ? String(data.body) : '',
          android: {
            channelId: 'tripick-default',
            importance: AndroidImportance.HIGH,
            smallIcon: 'ic_launcher',
            pressAction: { id: 'default' },
          },
        });
      });
    }
  } catch (error) {
    console.warn('[TriPick] FCM 백그라운드 핸들러 생략:', error?.message ?? error);
  }
}

AppRegistry.registerComponent(appName, () => App);
