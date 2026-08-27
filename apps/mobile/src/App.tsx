import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Platform,
  PermissionsAndroid,
  Pressable,
  StatusBar,
  StyleSheet,
  ToastAndroid,
  Text,
  View,
  Linking,
  NativeModules,
  NativeEventEmitter,
  useColorScheme,
  type EmitterSubscription,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { getApps } from '@react-native-firebase/app';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import Geolocation from 'react-native-geolocation-service';
import * as Keychain from 'react-native-keychain';

type FirebaseMessagingModule = typeof import('@react-native-firebase/messaging');

declare const require: <TModule>(moduleName: string) => TModule;

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
 * - 사진 업로드(취향 사진·프로필)는 웹의 <input type=file> 을 react-native-webview 가
 *   Android onShowFileChooser / iOS WKWebView 로 직접 처리한다. 네이티브 picker 브리지 없음
 */

type BridgeMessage =
  | { type: 'REQUEST_LOCATION' }
  | { type: 'START_LOCATION_TRACKING' }
  | { type: 'STOP_LOCATION_TRACKING' }
  | { type: 'LOCATION_AUTH'; apiBaseUrl: string; accessToken: string }
  | { type: 'STORE_REFRESH_TOKEN'; token: string }
  | { type: 'CLEAR_REFRESH_TOKEN' }
  | { type: 'REQUEST_REFRESH_TOKEN'; requestId: string }
  | { type: 'OPEN_EXTERNAL'; url: string }
  | { type: 'WEB_READY' }
  | { type: 'NAV_STATE'; canGoBack: boolean }
  | { type: 'OVERLAY_STATE'; open: boolean }
  | {
      type: 'SAVE_FILE';
      requestId: string;
      fileName: string;
      mimeType: string;
      base64: string;
    };

const PRODUCTION_WEB_APP_URL = 'https://tripick.place';
const WEB_APP_HOST = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
const WEB_APP_URL = __DEV__ ? WEB_APP_HOST : PRODUCTION_WEB_APP_URL;
// 첫 진입은 랜딩(`/start`). 루트(`/`)는 로그인 필수 화면이라 미로그인 사용자가 랜딩을
// 못 보고 바로 /login 으로 떨어졌다. 로그인 상태면 /start 의 GuestGuard 가 `/` 로 되돌린다.
const ENTRY_PATH = '/start';
const WEB_APP_ORIGIN = new URL(WEB_APP_URL).origin;
const PRODUCTION_WEB_APP_ORIGIN = new URL(PRODUCTION_WEB_APP_URL).origin;
const KAKAO_CALLBACK_PATH = '/auth/kakao/callback';
const KAKAO_APP_LINK_PROTOCOL = 'tripick:';

// 하단 탭 5개의 루트 경로 (web `NAV_ITEMS` 와 같은 목록). `/trips` 는 `/` 와 같은 화면이라 함께 본다.
const TAB_ROOT_PATHS = new Set(['/', '/trips', '/preferences', '/friends', '/inbox', '/settings']);
// "한 번 더 누르면 종료" 유효 시간. ToastAndroid.SHORT(약 2초) 와 맞춰 토스트가 떠 있는 동안만 무장한다.
const EXIT_CONFIRM_WINDOW_MS = 2000;

function isTabRootUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    return TAB_ROOT_PATHS.has(normalized);
  } catch {
    return false;
  }
}

function isInternalWebUrl(url: string): boolean {
  try {
    const origin = new URL(url).origin;
    return origin === WEB_APP_ORIGIN || origin === PRODUCTION_WEB_APP_ORIGIN;
  } catch {
    return false;
  }
}

/** 검증된 Android App Link 로 들어온 카카오 콜백만 WebView 에 다시 싣는다. */
function getKakaoCallbackUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin === PRODUCTION_WEB_APP_ORIGIN && parsed.pathname === KAKAO_CALLBACK_PATH) {
      return parsed.toString();
    }

    if (
      parsed.protocol !== KAKAO_APP_LINK_PROTOCOL ||
      parsed.hostname !== 'auth' ||
      parsed.pathname !== '/kakao/callback'
    ) {
      return null;
    }

    const callback = new URL(KAKAO_CALLBACK_PATH, PRODUCTION_WEB_APP_ORIGIN);
    const code = parsed.searchParams.get('code');
    const error = parsed.searchParams.get('error');
    if (code) callback.hash = `code=${encodeURIComponent(code)}`;
    else if (error) callback.searchParams.set('error', error);
    else return null;
    return callback.toString();
  } catch {
    return null;
  }
}

// react-native-webview 13.x 타입 union 에서 Android 전용 onPermissionRequest 가 빠져있다.
// Platform 분기로 prop 을 객체에 모아 spread 하면 타입 충돌 없이 안드로이드에만 적용된다.
// Android 전용 백그라운드 위치 추적 네이티브 모듈 (foreground service).
// iOS 는 모듈이 없어 undefined → watchPosition 폴백을 사용한다.
type LocationTrackingNative = { start(): void; stop(): void };
const LocationTracking = (NativeModules.LocationTracking ?? null) as LocationTrackingNative | null;

// Android 전용 파일 저장 네이티브 모듈. 웹의 "이미지·PDF 저장" 은 data: URI 를 <a download> 로
// 흘리는데, Android WebView 의 다운로드 리스너는 http/https 만 받아 조용히 버린다
// ("Can only download HTTP/HTTPS URIs"). 그래서 base64 를 브리지로 받아 네이티브가 저장한다.
type FileSaveNative = {
  saveBase64(fileName: string, mimeType: string, base64: string): Promise<string>;
};
const FileSave = (NativeModules.TripickFileSave ?? null) as FileSaveNative | null;
const LOCATION_EVENT = 'TripickLocationUpdate';
const LOCATION_ERROR_EVENT = 'TripickLocationError';
// 서버 위치 보고 최소 간격(ms). 미도착 판정은 분 단위라 과보고를 막는다(웹 스로틀과 동일).
const LOCATION_REPORT_THROTTLE_MS = 60_000;

// refresh 토큰을 담는 SecureStore(iOS Keychain / Android Keystore) 서비스 키.
// WebView localStorage 에 두던 장수 자격증명을 여기로 옮겨 검사·탈취 노출면을 줄인다.
const REFRESH_TOKEN_SERVICE = 'place.tripick.refreshToken';
const REFRESH_TOKEN_ACCOUNT = 'refreshToken';

const androidOnlyProps =
  Platform.OS === 'android'
    ? {
        onPermissionRequest: (request: { grant: (r: string[]) => void; resources: string[] }) =>
          request.grant(request.resources),
      }
    : {};

export default function App() {
  // 시스템 바 아이콘·셸 배경을 웹 팔레트(--app-bg)와 같은 명암으로 맞춘다.
  // 하나로 고정해 두면 다크에서 상태바 아이콘이 어두운 배경에 묻히고, 로딩 순간 흰 판이 번쩍인다.
  const isDark = useColorScheme() === 'dark';
  const shellColor = isDark ? SHELL_BG_DARK : SHELL_BG_LIGHT;
  const webViewRef = useRef<InstanceType<typeof WebView>>(null);
  const watchIdRef = useRef<number | null>(null);
  const nativeSubsRef = useRef<EmitterSubscription[]>([]);
  // 웹이 넘겨준 인증정보 + 마지막 서버 보고 시각. 앱이 백그라운드·종료돼 웹뷰가 사라져도
  // foreground service 로 잡은 위치를 이 정보로 서버에 직접 POST 한다.
  const locationConfigRef = useRef<{ apiBaseUrl: string; accessToken: string } | null>(null);
  const lastServerReportRef = useRef(0);
  // 마지막으로 받은 위치 + 하트비트 타이머. 위치는 이동 기반으로만 갱신돼 정지 시 콜백이 끊기므로,
  // 하트비트가 마지막 위치를 주기 재보고해 서버 캐시를 신선하게 유지한다(정지 no-show 판정 가능).
  const lastLocationRef = useRef<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 앱이 종료 상태에서 푸시 탭으로 켜졌을 때, WebView 로드가 끝나기 전 도착한 탭을 보관했다가 flush.
  const pendingTapRef = useRef<Record<string, string> | null>(null);
  const handledDeepLinkRef = useRef<string | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const [canGoBack, setCanGoBack] = useState(false);
  // 하단 탭 루트에 있는지 — 뒤로가기를 히스토리 이동 대신 "종료 확인" 으로 돌리는 기준.
  const [isTabRoot, setIsTabRoot] = useState(false);
  // 종료 확인이 무장된 시각(epoch ms). 타이머 없이 시간만 비교해 두 번째 입력을 판정한다.
  const exitArmedUntilRef = useRef(0);
  // 웹이 바텀시트·모달을 띄우고 있는지. 떠 있으면 뒤로가기를 히스토리·종료가 아니라 "시트 닫기" 로 돌린다.
  const overlayOpenRef = useRef(false);
  const [webViewKey, setWebViewKey] = useState(0);
  const [webViewUri, setWebViewUri] = useState(`${WEB_APP_URL}${ENTRY_PATH}`);
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);

  const handleIncomingUrl = useCallback((url: string) => {
    const callbackUrl = getKakaoCallbackUrl(url);
    if (!callbackUrl || handledDeepLinkRef.current === callbackUrl) return;
    handledDeepLinkRef.current = callbackUrl;
    setInitialLoadFailed(false);
    setWebViewUri(callbackUrl);
  }, []);

  useEffect(() => {
    requestPermissions();
    setupFcm();
    // 앱 종료 시 위치 워치 정리
    return () => stopTracking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 카카오 인증은 시스템 브라우저에서 진행한다. API 가 성공 후 tripick.place 콜백으로
  // 리디렉트하면 Android App Link 가 앱을 열고, 그 URL 을 WebView 에 넘겨 세션을 교환한다.
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => handleIncomingUrl(url));
    Linking.getInitialURL()
      .then((url) => {
        if (url) handleIncomingUrl(url);
      })
      .catch(() => undefined);
    return () => subscription.remove();
  }, [handleIncomingUrl]);

  // Android 하드웨어 백버튼 → WebView 히스토리 이동, 종료 지점에선 "한 번 더 누르면 종료".
  //
  // 탭 루트에서 히스토리를 계속 되짚지 않는 이유 — 탭 이동도 웹 히스토리에 쌓이므로 그대로 두면
  // 뒤로가기가 방문한 탭들을 거꾸로 훑는다. 하단 탭이 있는 앱에서 기대되는 동작은 "탭 루트면 종료" 다.
  // 히스토리가 아예 없는 화면(딥링크 진입 등)도 같은 확인을 거쳐 오조작 종료를 막는다.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // 시트·모달이 떠 있으면 그것부터 닫는다. 네이티브는 웹이 무엇을 띄웠는지 모르므로
      // 웹이 알려 준 상태(OVERLAY_STATE)를 보고 웹의 닫기 함수를 부른다 — 이게 없으면
      // 탭 루트에선 시트를 열어 둔 채 종료 확인이 뜨고, 그 밖에선 화면만 빠져나간다.
      if (overlayOpenRef.current) {
        webViewRef.current?.injectJavaScript(
          'window.__tripickBack && window.__tripickBack(); true;',
        );
        return true;
      }
      if (canGoBack && !isTabRoot) {
        webViewRef.current?.goBack();
        return true;
      }
      // 무장 중(=토스트가 떠 있는 동안)의 두 번째 입력만 미소비로 흘려 Activity 를 끝낸다.
      if (Date.now() < exitArmedUntilRef.current) return false;
      exitArmedUntilRef.current = Date.now() + EXIT_CONFIRM_WINDOW_MS;
      ToastAndroid.show('한 번 더 누르면 종료됩니다', ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  }, [canGoBack, isTabRoot]);

  const requestPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    const required = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ];
    const post = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    if (post) required.push(post); // Android 13+ 만 존재
    const result = await PermissionsAndroid.requestMultiple(required);

    // 백그라운드(항상 허용) 위치는 포그라운드 권한이 먼저 승인된 뒤에만 요청 가능.
    // Android 11+(API 30+)은 이 요청이 곧장 설정 화면을 유도한다.
    const fineGranted =
      result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
      PermissionsAndroid.RESULTS.GRANTED;
    const background = PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION;
    if (fineGranted && background) {
      try {
        await PermissionsAndroid.request(background, {
          title: '백그라운드 위치 권한',
          message:
            '여행 진행 중 앱을 보고 있지 않을 때도 경로 이탈을 감지하려면 위치를 "항상 허용"으로 설정해 주세요.',
          buttonPositive: '확인',
          buttonNegative: '나중에',
        });
      } catch {
        // 거부/미지원이어도 포그라운드 추적은 계속 동작하므로 무시한다.
      }
    }
  }, []);

  const setupFcm = useCallback(async () => {
    try {
      if (__DEV__) {
        console.warn('[TriPick] FCM 초기화 생략: local dev build.');
        return;
      }

      if (getApps().length === 0) {
        console.warn('[TriPick] FCM 초기화 생략: Firebase default app is not configured.');
        return;
      }

      const {
        AuthorizationStatus,
        getInitialNotification,
        getMessaging,
        getToken,
        onMessage,
        onNotificationOpenedApp,
        onTokenRefresh,
        requestPermission,
      } = require<FirebaseMessagingModule>('@react-native-firebase/messaging');

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
            // 탭 시 onForegroundEvent(PRESS) 가 이 data 로 라우팅하도록 payload 를 실어둔다.
            ...(data ? { data } : {}),
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

      // 포그라운드에서 notifee 알림을 탭한 경우 → 해당 화면으로 라우팅.
      const unsubscribeForegroundEvent = notifee.onForegroundEvent(({ type, detail }) => {
        if (type === EventType.PRESS) {
          dispatchNotificationTap(detail.notification?.data);
        }
      });

      // 백그라운드(앱 실행 중, OS 표시 알림)에서 탭 → 앱 포그라운드 전환 시 라우팅.
      const unsubscribeOpenedApp = onNotificationOpenedApp(messaging, (remoteMessage) => {
        dispatchNotificationTap(remoteMessage?.data);
      });

      // 종료 상태에서 탭으로 앱이 켜진 경우 → WebView 로드 완료 후 flush 하도록 보관.
      const initial = await getInitialNotification(messaging);
      if (initial?.data) {
        pendingTapRef.current = normalizeTapData(initial.data);
      }

      return () => {
        unsubscribeRefresh();
        unsubscribeMessage();
        unsubscribeForegroundEvent();
        unsubscribeOpenedApp();
      };
    } catch (error) {
      // Firebase 자격 파일(google-services.json / GoogleService-Info.plist) 미배치 시 정상적으로 건너뛴다.
      console.warn('[TriPick] FCM 초기화 생략:', error instanceof Error ? error.message : error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispatchNotificationTap 은 postToWeb(webviewRef) 만 쓰는 안정 함수라, 재구독을 막으려 빈 deps 를 의도적으로 유지
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
   * 위치를 서버에 직접 보고한다(미도착 감지용). 웹뷰가 살아있든 아니든 네이티브가 담당하므로
   * 앱 백그라운드·종료 상태(웹뷰 JS 정지)에서도 foreground service 가 이 경로로 보고를 이어간다.
   * 웹이 LOCATION_AUTH 로 인증정보를 넘기기 전이면 no-op. 스로틀로 과보고를 막고 실패는 무시한다.
   */
  const reportLocationToServer = useCallback((lat: number, lng: number, accuracy?: number) => {
    lastLocationRef.current = { lat, lng, accuracy };
    const config = locationConfigRef.current;
    if (!config) return;

    const now = Date.now();
    if (now - lastServerReportRef.current < LOCATION_REPORT_THROTTLE_MS) return;
    lastServerReportRef.current = now;

    fetch(`${config.apiBaseUrl}/live/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify({ lat, lng, ...(accuracy !== undefined ? { accuracy } : {}) }),
    }).catch(() => undefined);
  }, []);

  /**
   * 여행 진행(Live) 화면이 켜져 있는 동안 연속 위치 추적.
   * 웹의 useCurrentLocation 이 START/STOP_LOCATION_TRACKING 으로 켜고 끈다.
   * - Android: 네이티브 foreground service 모듈로 화면이 꺼져도 추적 유지
   * - iOS: Always 권한 + UIBackgroundModes(location) 기반 watchPosition 폴백
   *   (distanceFilter 10m 로 배터리·네트워크 절약)
   */
  const startTracking = useCallback(() => {
    // 하트비트: 위치 콜백이 끊겨도(정지) 마지막 위치를 주기 재보고해 서버 캐시를 신선하게 유지.
    if (!heartbeatRef.current) {
      heartbeatRef.current = setInterval(() => {
        const l = lastLocationRef.current;
        if (l) reportLocationToServer(l.lat, l.lng, l.accuracy);
      }, LOCATION_REPORT_THROTTLE_MS);
    }

    // Android: foreground service 네이티브 모듈 우선
    if (LocationTracking) {
      if (nativeSubsRef.current.length > 0) return; // 이미 추적 중
      const emitter = new NativeEventEmitter(NativeModules.LocationTracking);
      nativeSubsRef.current = [
        emitter.addListener(LOCATION_EVENT, (e: { lat: number; lng: number; accuracy?: number; timestamp?: number }) => {
          postToWeb({ type: 'LOCATION_UPDATE', ...e });
          reportLocationToServer(e.lat, e.lng, e.accuracy);
        }),
        emitter.addListener(LOCATION_ERROR_EVENT, (e: { code: number; message: string }) => {
          postToWeb({ type: 'LOCATION_ERROR', code: e.code, message: e.message });
        }),
      ];
      LocationTracking.start();
      return;
    }

    // iOS / 폴백: watchPosition
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
        reportLocationToServer(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
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
  }, [reportLocationToServer]);

  const stopTracking = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (LocationTracking) {
      LocationTracking.stop();
      nativeSubsRef.current.forEach((sub) => sub.remove());
      nativeSubsRef.current = [];
      return;
    }
    if (watchIdRef.current === null) return;
    Geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
  }, []);

  function postToWeb(payload: unknown) {
    const json = JSON.stringify(payload).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const js = `window.postMessage('${json}', '${WEB_APP_ORIGIN}'); true;`;
    webViewRef.current?.injectJavaScript(js);
  }

  // FCM data 값은 string | object 로 올 수 있어 웹이 기대하는 Record<string,string> 로 보정.
  function normalizeTapData(data?: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(data ?? {})) {
      if (value === undefined || value === null) continue;
      out[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return out;
  }

  // 푸시 탭 → 웹으로 라우팅 신호. 웹의 rn-bridge 가 category/tripId 로 이동 경로를 정한다.
  function dispatchNotificationTap(data?: Record<string, unknown>) {
    postToWeb({ type: 'NOTIFICATION_TAP', data: normalizeTapData(data) });
  }

  // 웹이 만든 이미지·PDF(base64)를 네이티브가 다운로드 폴더에 저장한다.
  // 결과는 requestId 를 실어 돌려줘, 웹이 스피너를 내리고 실패만 자기 UI 로 알린다.
  function saveFileToDownloads(
    requestId: string,
    fileName: string,
    mimeType: string,
    base64: string,
  ) {
    if (!FileSave) {
      postToWeb({ type: 'SAVE_FILE_RESULT', requestId, ok: false });
      return;
    }
    FileSave.saveBase64(fileName, mimeType || 'application/octet-stream', base64)
      .then(() => {
        ToastAndroid.show(`다운로드 폴더에 ${fileName} 저장했어요`, ToastAndroid.SHORT);
        postToWeb({ type: 'SAVE_FILE_RESULT', requestId, ok: true });
      })
      .catch((err) => {
        console.warn('[TriPick] 파일 저장 실패:', err);
        postToWeb({ type: 'SAVE_FILE_RESULT', requestId, ok: false });
      });
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
    if (msg.type === 'LOCATION_AUTH' && msg.apiBaseUrl && msg.accessToken) {
      // 웹뷰가 사라진 뒤에도 서버로 위치를 직접 POST 하도록 인증정보를 보관한다.
      locationConfigRef.current = { apiBaseUrl: msg.apiBaseUrl, accessToken: msg.accessToken };
      return;
    }
    if (msg.type === 'STORE_REFRESH_TOKEN' && typeof msg.token === 'string' && msg.token) {
      // 로그인·토큰 회전 시 refresh 를 SecureStore 에 저장. 잠금 해제 후엔 백그라운드에서도 조회 가능.
      Keychain.setGenericPassword(REFRESH_TOKEN_ACCOUNT, msg.token, {
        service: REFRESH_TOKEN_SERVICE,
        accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
      }).catch((err) => console.warn('[TriPick] refresh 토큰 저장 실패:', err));
      return;
    }
    if (msg.type === 'CLEAR_REFRESH_TOKEN') {
      // 로그아웃·탈퇴 시 SecureStore 에서 refresh 제거.
      Keychain.resetGenericPassword({ service: REFRESH_TOKEN_SERVICE }).catch((err) =>
        console.warn('[TriPick] refresh 토큰 삭제 실패:', err),
      );
      return;
    }
    if (msg.type === 'REQUEST_REFRESH_TOKEN' && typeof msg.requestId === 'string') {
      // 웹의 refresh 흐름이 요청 → SecureStore 값을 REFRESH_TOKEN 응답으로 돌려준다(없으면 null).
      // requestId 를 그대로 실어 웹이 어느 요청의 응답인지 상관(correlate)하게 한다.
      const { requestId } = msg;
      Keychain.getGenericPassword({ service: REFRESH_TOKEN_SERVICE })
        .then((cred) =>
          postToWeb({ type: 'REFRESH_TOKEN', requestId, token: cred ? cred.password : null }),
        )
        .catch(() => postToWeb({ type: 'REFRESH_TOKEN', requestId, token: null }));
      return;
    }
    if (msg.type === 'OVERLAY_STATE') {
      overlayOpenRef.current = msg.open === true;
      return;
    }
    if (msg.type === 'SAVE_FILE' && msg.requestId && msg.fileName && msg.base64) {
      saveFileToDownloads(msg.requestId, msg.fileName, msg.mimeType, msg.base64);
      return;
    }
    if (msg.type === 'OPEN_EXTERNAL' && msg.url) {
      Linking.openURL(msg.url).catch(() => undefined);
      return;
    }
    if (msg.type === 'WEB_READY') {
      // 웹이 message 리스너를 붙인 시점 — 종료 상태 탭으로 보관해둔 라우팅을 이제 안전하게 전달.
      if (pendingTapRef.current) {
        dispatchNotificationTap(pendingTapRef.current);
        pendingTapRef.current = null;
      }
    }
  }

  const handleInitialLoadError = useCallback(() => {
    if (!hasLoadedOnceRef.current) setInitialLoadFailed(true);
  }, []);

  const retryInitialLoad = useCallback(() => {
    hasLoadedOnceRef.current = false;
    setInitialLoadFailed(false);
    setWebViewKey((current) => current + 1);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: shellColor }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <WebView
        key={webViewKey}
        ref={webViewRef}
        source={{ uri: webViewUri }}
        style={[styles.webview, { backgroundColor: shellColor }]}
        // Next.js 웹앱이 필요로 하는 설정
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        // Kakao Maps 가 https 리소스를 요청하므로 mixed content 는 허용 X
        mixedContentMode="never"
        allowsBackForwardNavigationGestures
        // 사진은 <input type=file> → 네이티브 파일 선택 시트로만 올린다(getUserMedia 미사용)
        mediaPlaybackRequiresUserAction={false}
        // Geolocation + Android 전용 권한 brige
        geolocationEnabled
        {...androidOnlyProps}
        // 외부 도메인 진입 차단 → 시스템 브라우저로 위임
        onShouldStartLoadWithRequest={(request) => {
          if (isInternalWebUrl(request.url)) return true;
          if (request.url.startsWith('about:') || request.url === 'about:blank') return true;
          Linking.openURL(request.url).catch(() => undefined);
          return false;
        }}
        onNavigationStateChange={(state) => {
          console.log('[TriPick] WebView URL:', state.url);
          setCanGoBack(state.canGoBack);
          setIsTabRoot(isTabRootUrl(state.url));
          // 페이지가 바뀌면 열려 있던 시트도 함께 사라진다 — 웹의 알림을 못 받는 경우에 대비해 여기서도 내린다.
          overlayOpenRef.current = false;
          // 화면이 바뀌면 직전 화면에서 켜 둔 종료 확인은 무효 — 탭을 옮긴 직후의 뒤로가기가
          // 곧장 종료로 이어지지 않게 한다.
          exitArmedUntilRef.current = 0;
        }}
        onLoad={() => {
          hasLoadedOnceRef.current = true;
          setInitialLoadFailed(false);
        }}
        onError={handleInitialLoadError}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode >= 400) handleInitialLoadError();
        }}
        onMessage={handleMessage}
        // 로딩 인디케이터는 web 의 스켈레톤이 담당하므로 native 에선 비움
        renderLoading={() => <View style={[styles.loadingFill, { backgroundColor: shellColor }]} />}
        renderError={() => <View style={[styles.loadingFill, { backgroundColor: shellColor }]} />}
        startInLoadingState
      />
      {initialLoadFailed ? (
        <View style={styles.loadError} accessibilityRole="alert">
          <Text style={styles.loadErrorTitle}>페이지를 불러오지 못했어요</Text>
          <Text style={styles.loadErrorMessage}>네트워크 연결을 확인하고 다시 시도해 주세요.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="페이지 다시 불러오기"
            onPress={retryInitialLoad}
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
          >
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// 웹 팔레트의 --app-bg 와 같은 값 (라이트 #F2F4F6 / 다크 #0B111E).
// android/app/src/main/res/values{,-night}/colors.xml 의 window_bg 와도 같은 값이어야
// 시스템 바 뒤(창 배경)와 웹뷰 면이 이어져 보인다.
const SHELL_BG_LIGHT = '#F2F4F6';
const SHELL_BG_DARK = '#0B111E';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SHELL_BG_LIGHT },
  webview: { flex: 1, backgroundColor: SHELL_BG_LIGHT },
  loadingFill: { flex: 1, backgroundColor: SHELL_BG_LIGHT },
  loadError: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    backgroundColor: '#F7F8FA',
    paddingHorizontal: 32,
  },
  loadErrorTitle: {
    color: '#191F28',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 28,
    textAlign: 'center',
  },
  loadErrorMessage: {
    color: '#6B7684',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: '#3182F6',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    marginTop: 24,
    minWidth: 136,
    paddingHorizontal: 24,
  },
  retryButtonPressed: { backgroundColor: '#1B64DA' },
  retryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
