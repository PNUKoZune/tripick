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
import messaging from '@react-native-firebase/messaging';
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
  | { type: 'OPEN_EXTERNAL'; url: string }
  | { type: 'NAV_STATE'; canGoBack: boolean };

const WEB_APP_HOST =
  Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
const WEB_APP_URL = __DEV__ ? WEB_APP_HOST : 'https://tripick.vercel.app';
const ENTRY_PATH = '/trips';
const WEB_APP_ORIGIN = new URL(WEB_APP_URL).origin;

export default function App() {
  const webViewRef = useRef<InstanceType<typeof WebView>>(null);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    requestPermissions();
    setupFcm();
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
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;
    if (!enabled) return;

    const token = await messaging().getToken();
    postToWeb({ type: 'FCM_TOKEN', token });

    const unsubscribe = messaging().onMessage(async (remoteMessage) => {
      postToWeb({ type: 'PUSH_NOTIFICATION', data: remoteMessage });
    });
    return unsubscribe;
  }, []);

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
        decelerationRate="normal"
        // 카메라/마이크는 v1에서 사용 안 함. 추후 preference-analyzer 단계에서 활성화
        mediaPlaybackRequiresUserAction={false}
        // Geolocation
        geolocationEnabled
        onPermissionRequest={(request) => request.grant(request.resources)}
        // 외부 도메인 진입 차단 → 시스템 브라우저로 위임
        onShouldStartLoadWithRequest={(request) => {
          if (request.url.startsWith(WEB_APP_ORIGIN)) return true;
          if (request.url.startsWith('about:') || request.url === 'about:blank') return true;
          Linking.openURL(request.url).catch(() => undefined);
          return false;
        }}
        onNavigationStateChange={(state) => setCanGoBack(state.canGoBack)}
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
