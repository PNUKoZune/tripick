import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Platform,
  PermissionsAndroid,
  StatusBar,
  StyleSheet,
  View,
  Linking,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  AuthorizationStatus,
  getMessaging,
  getToken,
  onMessage,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';
import Geolocation from 'react-native-geolocation-service';

/**
 * TriPick React Native WebView Shell
 *
 * 역할:
 * 1. Next.js 웹앱(/trips, /planner) 을 WebView 로 렌더링
 * 2. FCM 토큰/푸시 메시지를 WebView 로 브리지
 * 3. 위치 권한 요청 + 현재 위치 주입 (deviation detection 대비)
 * 4. Android 하드웨어 백 버튼으로 WebView 히스토리 이동
 * 5. 외부 링크(http/https 도메인 외) 는 시스템 브라우저로 위임
 *
 * 환경 변수:
 * - DEV: 시뮬레이터/에뮬레이터 기본 호스트로 fallback
 * - PROD: 배포된 Next.js URL (Vercel)
 *
 * 주의:
 * - Geolocation 은 HTTPS 또는 localhost 환경에서만 동작 (Android WebView 제약)
 * - Android 13+ 는 POST_NOTIFICATIONS 런타임 권한 필요
 * - iOS 는 Info.plist 에 NSLocationWhenInUseUsageDescription / aps-environment 필수
 */

type BridgeMessage =
  | { type: 'REQUEST_LOCATION' }
  | { type: 'START_LOCATION_TRACKING' }
  | { type: 'STOP_LOCATION_TRACKING' }
  | { type: 'OPEN_EXTERNAL'; url: string }
  | { type: 'NAV_STATE'; canGoBack: boolean };

const WEB_APP_HOST = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
const WEB_APP_URL = __DEV__ ? WEB_APP_HOST : 'https://tripick.vercel.app';
// 라우트가 아직 정해지지 않은 단계에선 루트로 진입. planner v1 (`/trips`) 머지된 뒤 변경.
const ENTRY_PATH = '/';
const WEB_APP_ORIGIN = new URL(WEB_APP_URL).origin;

// react-native-webview 13.x 타입 union 에서 Android 전용 onPermissionRequest 가 빠져있다.
// Platform 분기로 prop 을 객체에 모아 spread 하면 타입 충돌 없이 안드로이드에만 적용된다.
const androidOnlyProps =
  Platform.OS === 'android'
    ? {
        onPermissionRequest: (request: { grant: (r: string[]) => void; resources: string[] }) =>
          request.grant(request.resources),
      }
    : {};

export default function App() {
  const webViewRef = useRef<InstanceType<typeof WebView>>(null);
  const watchIdRef = useRef<number | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    requestPermissions();
    setupFcm();
    // 앱 종료 시 위치 워치 정리
    return () => stopTracking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android 하드웨어 백버튼 → WebView 히스토리 이동 (없으면 앱 종료)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  const requestPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    const required = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ];
    const post = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    if (post) required.push(post); // Android 13+ 만 존재
    await PermissionsAndroid.requestMultiple(required);
  }, []);

  const setupFcm = useCallback(async () => {
    try {
      // 포그라운드/백그라운드 공용 Android 채널. iOS 는 무시.
      await notifee.createChannel({
        id: 'tripick-default',
        name: 'TriPick 알림',
        importance: AndroidImportance.HIGH,
      });

      const messaging = getMessaging();
      const authStatus = await requestPermission(messaging);
      const enabled =
        authStatus === AuthorizationStatus.AUTHORIZED ||
        authStatus === AuthorizationStatus.PROVISIONAL;
      if (!enabled) return;

      const token = await getToken(messaging);
      postToWeb({ type: 'FCM_TOKEN', token });

      // 토큰 갱신(앱 데이터 초기화·재설치·12개월 미사용 등) 시에도 백엔드에 다시 보낸다.
      const unsubscribeRefresh = onTokenRefresh(messaging, (next) => {
        postToWeb({ type: 'FCM_TOKEN', token: next });
      });

      // 포그라운드 메시지는 OS 가 표시하지 않으므로 notifee 로 직접 표시 + WebView 에 invalidate 신호.
      const unsubscribeMessage = onMessage(messaging, async (remoteMessage) => {
        const { notification, data } = remoteMessage ?? {};
        const title = notification?.title ?? (data?.title ? String(data.title) : 'TriPick');
        const body = notification?.body ?? (data?.body ? String(data.body) : '');
        if (title || body) {
          await notifee.displayNotification({
            title,
            body,
            android: {
              channelId: 'tripick-default',
              importance: AndroidImportance.HIGH,
              smallIcon: 'ic_launcher',
              pressAction: { id: 'default' },
            },
          });
        }
        postToWeb({ type: 'PUSH_NOTIFICATION', data: remoteMessage });
      });

      return () => {
        unsubscribeRefresh();
        unsubscribeMessage();
      };
    } catch (error) {
      // Firebase 자격 파일(google-services.json / GoogleService-Info.plist) 미배치 시 정상적으로 건너뛴다.
      console.warn('[TriPick] FCM 초기화 생략:', error instanceof Error ? error.message : error);
    }
  }, []);

  // 단발 위치 조회 (이전 호환용 — 웹은 현재 START_LOCATION_TRACKING 을 보낸다)
  const injectLocation = useCallback(() => {
    Geolocation.getCurrentPosition(
      (pos) => {
        postToWeb({
          type: 'LOCATION_UPDATE',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
      },
      (err) => {
        postToWeb({ type: 'LOCATION_ERROR', code: err.code, message: err.message });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
    );
  }, []);

  /**
   * 여행 진행(Live) 화면이 켜져 있는 동안 연속 위치 추적.
   * 웹의 useCurrentLocation 이 START/STOP_LOCATION_TRACKING 으로 켜고 끈다.
   * - distanceFilter: 10m 이동 시에만 갱신해 배터리/네트워크 절약
   * - iOS: Always 권한 + UIBackgroundModes(location) 가 있으면 백그라운드에서도 수신
   * - Android: 화면 꺼진 채 장시간 추적은 별도 foreground service 필요 (후속)
   */
  const startTracking = useCallback(() => {
    if (watchIdRef.current !== null) return; // 이미 추적 중이면 중복 등록 방지
    watchIdRef.current = Geolocation.watchPosition(
      (pos) => {
        postToWeb({
          type: 'LOCATION_UPDATE',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
      },
      (err) => {
        postToWeb({ type: 'LOCATION_ERROR', code: err.code, message: err.message });
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 10,
        interval: 5000,
        fastestInterval: 3000,
        showsBackgroundLocationIndicator: true,
      },
    );
  }, []);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current === null) return;
    Geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
  }, []);

  function postToWeb(payload: unknown) {
    const json = JSON.stringify(payload).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const js = `window.postMessage('${json}', '${WEB_APP_ORIGIN}'); true;`;
    webViewRef.current?.injectJavaScript(js);
  }

  function handleMessage(event: WebViewMessageEvent) {
    let msg: BridgeMessage | null = null;
    try {
      msg = JSON.parse(event.nativeEvent.data) as BridgeMessage;
    } catch {
      return;
    }
    if (!msg) return;
    if (msg.type === 'REQUEST_LOCATION') {
      injectLocation();
      return;
    }
    if (msg.type === 'START_LOCATION_TRACKING') {
      startTracking();
      return;
    }
    if (msg.type === 'STOP_LOCATION_TRACKING') {
      stopTracking();
      return;
    }
    if (msg.type === 'OPEN_EXTERNAL' && msg.url) {
      Linking.openURL(msg.url).catch(() => undefined);
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <WebView
        ref={webViewRef}
        source={{ uri: `${WEB_APP_URL}${ENTRY_PATH}` }}
        style={styles.webview}
        // Next.js 웹앱이 필요로 하는 설정
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        // Kakao Maps 가 https 리소스를 요청하므로 mixed content 는 허용 X
        mixedContentMode="never"
        allowsBackForwardNavigationGestures
        // 카메라/마이크는 v1에서 사용 안 함. 추후 preference-analyzer 단계에서 활성화
        mediaPlaybackRequiresUserAction={false}
        // Geolocation + Android 전용 권한 brige
        geolocationEnabled
        {...androidOnlyProps}
        // 외부 도메인 진입 차단 → 시스템 브라우저로 위임
        onShouldStartLoadWithRequest={(request) => {
          if (request.url.startsWith(WEB_APP_ORIGIN)) return true;
          if (request.url.startsWith('about:') || request.url === 'about:blank') return true;
          Linking.openURL(request.url).catch(() => undefined);
          return false;
        }}
        onNavigationStateChange={(state) => {
          console.log('[TriPick] WebView URL:', state.url);
          setCanGoBack(state.canGoBack);
        }}
        onMessage={handleMessage}
        // 로딩 인디케이터는 web 의 스켈레톤이 담당하므로 native 에선 비움
        renderLoading={() => <View style={styles.loadingFill} />}
        startInLoadingState
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA' },
  webview: { flex: 1, backgroundColor: '#F7F8FA' },
  loadingFill: { flex: 1, backgroundColor: '#F7F8FA' },
});
