import React, { useEffect, useRef } from 'react';
import { Platform, PermissionsAndroid, StatusBar, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import messaging from '@react-native-firebase/messaging';
import Geolocation from 'react-native-geolocation-service';

const WEB_APP_URL = __DEV__
  ? 'http://10.0.2.2:3000' // Android 에뮬레이터에서 localhost
  : 'https://tripick.vercel.app';

/**
 * TriPick React Native App
 *
 * 주요 역할:
 * 1. Next.js 웹앱을 WebView로 렌더링
 * 2. FCM 푸시 알림 수신 및 처리 (notifee 조합)
 * 3. 기기 위치 정보 획득 (Geolocation) → WebView로 주입
 *
 * 주의사항:
 * - Android WebView에서 geolocation 이중 권한 처리 필요 (onPermissionRequest)
 * - Geolocation은 HTTPS 또는 localhost에서만 동작
 */
export default function App() {
  const webViewRef = useRef<InstanceType<typeof WebView>>(null);

  useEffect(() => {
    requestPermissions();
    setupFcm();
  }, []);

  async function requestPermissions() {
    if (Platform.OS === 'android') {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION!,
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS!,
      ]);
    }
  }

  async function setupFcm() {
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (!enabled) return;

    const token = await messaging().getToken();
    // WebView로 FCM 토큰 전달
    webViewRef.current?.postMessage(JSON.stringify({ type: 'FCM_TOKEN', token }));

    // 포그라운드 메시지 처리
    messaging().onMessage(async (remoteMessage) => {
      webViewRef.current?.postMessage(
        JSON.stringify({ type: 'PUSH_NOTIFICATION', data: remoteMessage }),
      );
    });
  }

  function injectLocation() {
    Geolocation.getCurrentPosition(
      (pos) => {
        webViewRef.current?.postMessage(
          JSON.stringify({
            type: 'LOCATION_UPDATE',
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          }),
        );
      },
      (err) => console.warn('Geolocation error:', err),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <WebView
        ref={webViewRef}
        source={{ uri: WEB_APP_URL }}
        style={styles.webview}
        geolocationEnabled
        // Android WebView geolocation 이중 권한 처리
        onPermissionRequest={(request) => request.grant(request.resources)}
        onMessage={(event) => {
          try {
            const msg = JSON.parse(event.nativeEvent.data) as { type: string };
            if (msg.type === 'REQUEST_LOCATION') injectLocation();
          } catch {
            // noop
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
});
