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
  Animated,
  Image,
  type EmitterSubscription,
  type ImageSourcePropType,
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
  | { type: 'WEB_READY' }
  | { type: 'NAV_STATE'; canGoBack: boolean }
  | { type: 'THEME_CHANGE'; theme: 'light' | 'dark' }
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
// 이미 로그인해 둔 사용자의 진입 경로. `/start` 로 들어가면 랜딩이 한 번 그려진 뒤
// GuestGuard 가 `/` 로 되돌려, 켤 때마다 남의 화면이 스쳐 지나간 것처럼 보인다.
const SESSION_ENTRY_PATH = '/';
// 웹이 첫 화면을 그렸다고 알려주지 않을 때(구버전 웹 등) 스플래시를 걷어낼 상한.
const SPLASH_FALLBACK_MS = 10_000;
const SPLASH_FADE_MS = 220;
const APP_ICON = require('../../../assets/brand/tripick-app-icon-1024.png') as ImageSourcePropType;
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

/**
 * 웹뷰 밖(시스템 브라우저·기본 앱)으로 넘겨도 되는 URL 인지.
 *
 * 페이지가 시작한 내비게이션은 전부 이 판정을 거친다 — 스킴을 안 보면 `intent://` 나
 * 남의 앱 딥링크로 임의 앱을 띄우는 통로가 된다. 웹이 실제로 필요한 건 외부 https 링크와
 * 문의용 `mailto:` 이고, `tel:` 은 같은 성질이라 함께 허용한다.
 */
const DELEGATABLE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function isDelegatableUrl(url: string): boolean {
  try {
    return DELEGATABLE_PROTOCOLS.has(new URL(url).protocol);
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

const KAKAO_APP_LINK_URL = `${KAKAO_APP_LINK_PROTOCOL}//auth/kakao/callback`;

/**
 * 카카오 로그인 **시작** URL 인지. 서버가 `/auth/kakao/status` 로 내려주는 절대 주소이고
 * (API 오리진이라 웹뷰 입장에선 외부 URL), 그 뒤 카카오 왕복은 전부 열린 탭 안에서 끝난다.
 * 지도·문의 같은 평범한 외부 링크는 지금처럼 시스템 브라우저로 보낸다.
 */
function isKakaoAuthStartUrl(url: string): boolean {
  try {
    return /\/auth\/kakao$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * 검증된 App Link(https) 또는 `tripick://` 딥링크로 들어온 카카오 콜백만 WebView 에 다시 싣는다.
 *
 * 돌아갈 오리진은 **지금 웹뷰가 보고 있는 곳**(`WEB_APP_ORIGIN`)이다. 릴리스에서는
 * 프로덕션과 같은 값이지만, 개발 빌드에서 프로덕션으로 고정하면 로컬 서버가 발급한
 * 교환 코드를 라이브 사이트가 받게 된다 — 코드도 없고 bind(localStorage)도 그쪽
 * 오리진엔 없어 로그인이 반드시 실패한다.
 *
 * ⚠️ 커스텀 스킴은 `URL` 로 뜯지 않는다. RN 의 URL 은 브라우저 것이 아니라 부분 폴리필이라
 * `host`·`hostname`·`pathname`·`origin` 의 정규식이 `https?:` 로 고정돼 있어 `tripick://` 은
 * hostname 이 빈 문자열로 나오고, `hash` 는 setter 자체가 없어 대입하면 TypeError 가 난다.
 * 예전 구현이 둘 다 밟아서 Android 복귀 딥링크가 조용히 무시됐다(= 카카오 로그인이 끝나지 않음).
 */
function getKakaoCallbackUrl(url: string): string | null {
  try {
    if (isInternalWebUrl(url) && new URL(url).pathname === KAKAO_CALLBACK_PATH) {
      return url;
    }

    if (!url.startsWith(KAKAO_APP_LINK_URL)) return null;
    // `tripick://auth/kakao/callback` 뒤에는 쿼리만 올 수 있다 — `...callbackXXX` 는 남이다.
    const query = url.slice(KAKAO_APP_LINK_URL.length);
    if (query && !query.startsWith('?')) return null;

    const params = new URLSearchParams(query);
    const code = params.get('code');
    const error = params.get('error');
    const callback = `${WEB_APP_ORIGIN}${KAKAO_CALLBACK_PATH}`;
    if (code) return `${callback}#code=${encodeURIComponent(code)}`;
    if (error) return `${callback}?error=${encodeURIComponent(error)}`;
    return null;
  } catch {
    return null;
  }
}

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

// 카카오 로그인을 시스템 브라우저 대신 앱 안에서 여는 모듈 (Android: Custom Tabs,
// iOS: ASWebAuthenticationSession). 시스템 브라우저로 내보내면 로그인 한 번에 앱이 통째로
// 두 번 전환된다.
//
// 복귀 방식이 플랫폼마다 다르다 — Android 는 서버가 `intent://` 로 앱을 다시 열어 딥링크로
// 돌아오므로 `open` 은 곧바로 null 로 끝나고, iOS 는 인증 세션이 `tripick://` 리다이렉트를
// 가로채 스스로 닫으며 **그 URL 을 이 promise 로** 돌려준다. 사용자가 닫았으면 양쪽 다 null.
type AuthTabNative = { open(url: string, toolbarColor: string | null): Promise<string | null> };
const AuthTab = (NativeModules.TripickAuthTab ?? null) as AuthTabNative | null;

// 설치된 앱 자신의 버전(versionName). 설정 화면이 웹 빌드 버전 대신 이걸 보여준다.
// iOS 는 아직 모듈이 없어 null → 웹이 자기 빌드 버전으로 폴백한다.
type AppInfoNative = { version?: string; build?: string };
const AppInfo = (NativeModules.TripickAppInfo ?? null) as AppInfoNative | null;
const LOCATION_EVENT = 'TripickLocationUpdate';
const LOCATION_ERROR_EVENT = 'TripickLocationError';
// 서버 위치 보고 최소 간격(ms). 미도착 판정은 분 단위라 과보고를 막는다(웹 스로틀과 동일).
const LOCATION_REPORT_THROTTLE_MS = 60_000;

// refresh 토큰을 담는 SecureStore(iOS Keychain / Android Keystore) 서비스 키.
// WebView localStorage 에 두던 장수 자격증명을 여기로 옮겨 검사·탈취 노출면을 줄인다.
const REFRESH_TOKEN_SERVICE = 'place.tripick.refreshToken';
const REFRESH_TOKEN_ACCOUNT = 'refreshToken';

export default function App() {
  // 시스템 바 아이콘·셸 배경을 웹 팔레트(--app-bg)와 같은 명암으로 맞춘다.
  // 하나로 고정해 두면 다크에서 상태바 아이콘이 어두운 배경에 묻히고, 로딩 순간 흰 판이 번쩍인다.
  // 웹 설정에서 OS 와 다른 테마를 고를 수 있으므로, 웹이 THEME_CHANGE 로 알려 주면 그쪽이 우선한다
  // (웹뷰가 아직 안 붙었거나 알림 전이면 OS 설정으로 시작 — 첫 프레임에 흰 판이 번쩍이지 않게).
  const systemDark = useColorScheme() === 'dark';
  const [webTheme, setWebTheme] = useState<'light' | 'dark' | null>(null);
  const isDark = webTheme ? webTheme === 'dark' : systemDark;
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
  // 진입 URL 은 저장된 세션 여부를 보고 정한다 — 정해지기 전엔 스플래시만 보이므로 null.
  const [webViewUri, setWebViewUri] = useState<string | null>(null);
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);
  // 웹이 첫 화면을 그릴 때까지 덮어 두는 스플래시. 이게 없으면 셸 배경만 깔린 빈 화면이
  // 몇 초 있다가 웹 화면이 툭 튀어나와, 흰 화면이 떴다 꺼진 것처럼 보인다.
  const [splashVisible, setSplashVisible] = useState(true);
  const [webPainted, setWebPainted] = useState(false);
  const splashOpacity = useRef(new Animated.Value(1)).current;

  const handleIncomingUrl = useCallback((url: string) => {
    const callbackUrl = getKakaoCallbackUrl(url);
    if (!callbackUrl || handledDeepLinkRef.current === callbackUrl) return;
    handledDeepLinkRef.current = callbackUrl;
    setInitialLoadFailed(false);
    setWebViewUri(callbackUrl);
  }, []);

  /**
   * 웹뷰 밖으로 내보내는 URL 을 실제로 연다.
   *
   * 카카오 로그인만 인앱 브라우저로 띄운다 — 앱 위에 얹혀 화면 전환 없이 열리고, 쿠키는
   * 시스템 브라우저와 같은 저장소를 써서 서버가 심는 state·bind 왕복이 그대로 성립한다.
   * 인앱 브라우저를 못 여는 기기는 예전처럼 시스템 브라우저로 내보낸다 — 로그인 창이
   * 아예 안 열리는 것보다 화면이 전환되는 편이 낫다.
   */
  const openOutsideWebView = useCallback(
    (url: string) => {
      const delegateToBrowser = () => {
        Linking.openURL(url).catch(() => undefined);
      };
      if (AuthTab && isKakaoAuthStartUrl(url)) {
        AuthTab.open(url, shellColor)
          // iOS 는 복귀 URL 이 여기로 온다. Android 는 null 이고 딥링크로 따로 들어온다.
          .then((callbackUrl) => {
            if (callbackUrl) handleIncomingUrl(callbackUrl);
          })
          .catch(delegateToBrowser);
        return;
      }
      delegateToBrowser();
    },
    [handleIncomingUrl, shellColor],
  );

  // 저장된 refresh 토큰이 있으면 로그인 사용자로 보고 홈으로 바로 들어간다.
  // 딥링크(카카오 콜백)가 먼저 URL 을 정했으면 그쪽이 우선.
  useEffect(() => {
    let cancelled = false;
    const enter = (path: string) => {
      if (cancelled || handledDeepLinkRef.current) return;
      setWebViewUri((current) => current ?? `${WEB_APP_URL}${path}`);
    };
    Keychain.getGenericPassword({ service: REFRESH_TOKEN_SERVICE })
      .then((cred) => enter(cred ? SESSION_ENTRY_PATH : ENTRY_PATH))
      .catch(() => enter(ENTRY_PATH));
    return () => {
      cancelled = true;
    };
  }, []);

  // 웹이 준비됐다고 알리면(WEB_READY) 스플래시를 부드럽게 걷는다. 신호가 안 오는
  // 경우(구버전 웹·로드 실패)에도 상한 시간이 지나면 걷어 화면이 잠기지 않게 한다.
  useEffect(() => {
    if (!splashVisible) return;
    if (!webPainted) {
      const timer = setTimeout(() => setWebPainted(true), SPLASH_FALLBACK_MS);
      return () => clearTimeout(timer);
    }
    const animation = Animated.timing(splashOpacity, {
      toValue: 0,
      duration: SPLASH_FADE_MS,
      // 네이티브 드라이버를 쓰면 이 저장소의 react(19.2.5)·react-native-renderer(19.2.3) 버전
      // 불일치가 __makeNative 경로에서 터진다. 220ms 페이드 하나라 JS 드라이버로 충분하다.
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished) setSplashVisible(false);
    });
    return () => animation.stop();
  }, [splashVisible, webPainted, splashOpacity]);

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
    if (msg.type === 'THEME_CHANGE' && (msg.theme === 'light' || msg.theme === 'dark')) {
      setWebTheme(msg.theme);
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
    if (msg.type === 'WEB_READY') {
      // 웹이 첫 화면을 그리고 리스너까지 붙인 시점 — 이제 스플래시를 걷어도 빈 화면이 안 보인다.
      setWebPainted(true);
      // 웹이 리스너를 붙였으니 앱 버전을 알려 준다(설정 화면 "버전" 표기용).
      if (AppInfo?.version) postToWeb({ type: 'APP_VERSION', version: AppInfo.version });
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
    setWebPainted(false);
    setSplashVisible(true);
    splashOpacity.setValue(1);
    setWebViewKey((current) => current + 1);
  }, [splashOpacity]);

  return (
    <View style={[styles.container, { backgroundColor: shellColor }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {webViewUri ? (
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
          // geolocation 권한은 JS 에서 손댈 게 없다 — 라이브러리 네이티브(RNCWebChromeClient)의
          // onGeolocationPermissionsShowPrompt 가 ACCESS_FINE_LOCATION 을 직접 확인·요청한다.
          // 예전엔 `onPermissionRequest` 로 요청 리소스를 통째로 grant 했는데, 그 이름은
          // react-native-webview 13.16.1 의 JS prop 에 아예 없어 호출되지 않는 죽은 코드였다.
          // 게다가 그 네이티브 콜백이 담당하는 건 geolocation 이 아니라 카메라·마이크·
          // protected media 라, 살아 있었다면 페이지 안의 아무 스크립트에나 캡처 권한을
          // 내주는 코드였다 — 되살리지 말 것.
          geolocationEnabled
          // 외부 도메인 진입 차단 → 시스템 브라우저로 위임
          onShouldStartLoadWithRequest={(request) => {
            if (isInternalWebUrl(request.url)) return true;
            if (request.url.startsWith('about:') || request.url === 'about:blank') return true;
            // 넘길 수 있는 스킴만 넘긴다. 예전엔 URL 을 그대로 openURL 에 흘려서,
            // 페이지가 만든 `intent://`·앱 딥링크로 임의의 다른 앱을 띄울 수 있었다.
            // (웹이 실제로 쓰는 건 https 링크와 문의용 mailto 뿐이다)
            if (!isDelegatableUrl(request.url)) return false;
            openOutsideWebView(request.url);
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
          renderLoading={() => (
            <View style={[styles.loadingFill, { backgroundColor: shellColor }]} />
          )}
          renderError={() => <View style={[styles.loadingFill, { backgroundColor: shellColor }]} />}
          startInLoadingState
        />
      ) : null}
      {/* 웹이 첫 화면을 그릴 때까지 덮는 스플래시. 실패 안내(아래)는 이보다 뒤에 그려 위로 올린다. */}
      {splashVisible ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.splash, { backgroundColor: shellColor, opacity: splashOpacity }]}
        >
          <Image source={APP_ICON} style={styles.splashIcon} resizeMode="contain" />
        </Animated.View>
      ) : null}
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
  splash: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  // Android 12+ 시스템 스플래시가 어댑티브 아이콘을 원형으로 마스킹해 먼저 보여준다 —
  // 이어받는 이 아이콘도 같은 원형·비슷한 크기로 그려야 두 장이 겹쳐 보이지 않는다.
  splashIcon: { borderRadius: 80, height: 160, overflow: 'hidden', width: 160 },
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
