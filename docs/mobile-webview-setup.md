# TriPick Mobile (React Native WebView) v1 setup

문서 목적: `apps/mobile` 의 React Native 셸이 Next.js 웹앱(`/trips`, `/planner`) 을 WebView 로 렌더링하기 위해 필요한 권한, 매니페스트 키, 브리지 메시지를 한 곳에 정리한다.

기준 브랜치: `feature/main-plan-page`
기준 RN: `0.85.x` + `react-native-webview ^13`, `@react-native-firebase/messaging ^24`, `react-native-geolocation-service ^5`

## 1. 책임 분리

- **Native (React Native 셸)**: WebView 렌더, OS 권한 요청, FCM 토큰 발급/푸시 수신, Geolocation 획득, 하드웨어 백버튼, 외부 링크 위임
- **Web (Next.js)**: 모든 UI/도메인 화면, REST/WebSocket 통신, 카카오맵 SDK 로드
- Native 는 도메인 UI 를 직접 그리지 않는다. 정보는 `window.postMessage` 로 web 에 전달, web 은 `RN.postMessage(...)` 로 native 에 요청한다.

## 2. v1 에서 실제 필요한 권한

### Android (`apps/mobile/android/app/src/main/AndroidManifest.xml`)

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <!-- 네트워크 -->
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

  <!-- 위치 (Geolocation, deviation detection 대비) -->
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
  <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />

  <!-- 푸시 알림 (Android 13+ 런타임 권한) -->
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

  <!-- FCM 부가 권한 -->
  <uses-permission android:name="android.permission.WAKE_LOCK" />
  <uses-permission android:name="android.permission.VIBRATE" />
  <uses-permission android:name="com.google.android.c2dm.permission.RECEIVE" />

  <application
      android:usesCleartextTraffic="true"  <!-- DEV 에뮬레이터 (10.0.2.2) 만 허용. release 빌드 전 제거 -->
      ...>
    <!-- WebView 가 file:// 리소스를 요청하지 않도록 기본값 유지 -->
  </application>
</manifest>
```

규칙:
- `ACCESS_BACKGROUND_LOCATION` 은 v1 에서 사용하지 않는다. 백그라운드 동선 감지 단계에서 별도 검토.
- `usesCleartextTraffic="true"` 는 dev 만. release 에선 `false` 또는 `network_security_config.xml` 로 도메인 화이트리스트.

### iOS (`apps/mobile/ios/TriPick/Info.plist`)

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>여행 동선 추천과 웨이팅 대안 제안을 위해 현재 위치가 필요해요.</string>

<key>UIBackgroundModes</key>
<array>
  <string>remote-notification</string>
</array>

<key>NSAppTransportSecurity</key>
<dict>
  <!-- DEV 시뮬레이터에서 http://localhost:3000 접근. release 에선 제거 또는 NSExceptionDomains 로 한정 -->
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>
```

추가로 푸시 사용 시 Xcode `Signing & Capabilities` 에서 **Push Notifications** 추가, `aps-environment` 가 자동 주입된다.

## 3. v1 에서 아직 추가하지 않는 권한 (backlog)

- `ACCESS_BACKGROUND_LOCATION` (Android) / `NSLocationAlwaysAndWhenInUseUsageDescription` (iOS) — 백그라운드 경로 이탈 감지
- `CAMERA` / `NSCameraUsageDescription` — 추후 preference-analyzer 사진 업로드
- `READ_MEDIA_IMAGES` (Android 13+) / `NSPhotoLibraryUsageDescription` (iOS) — 동일
- `INTERNET` 외 결제·블루투스 등은 v1 범위 아님

## 4. App.tsx 동작 요약

[apps/mobile/src/App.tsx](../apps/mobile/src/App.tsx)

| 동작                  | 설명                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| 진입 URL              | DEV: `http://10.0.2.2:3000/trips` (Android) / `http://localhost:3000/trips` (iOS) |
| 권한 요청             | mount 시 위치 + Android 13+ 푸시 권한 일괄 요청                                   |
| FCM                   | `messaging().requestPermission()` → `getToken()` → web 으로 `FCM_TOKEN` 메시지    |
| Geolocation           | web 에서 `REQUEST_LOCATION` 메시지 받으면 `getCurrentPosition` 결과를 web 으로 주입|
| Android 백버튼        | WebView 히스토리 있으면 `goBack()`, 없으면 OS 기본 동작(앱 종료)                  |
| 외부 링크             | WebView origin 외 URL 은 `Linking.openURL` 로 시스템 브라우저 위임                |
| Android geolocation   | `onPermissionRequest` 에서 `request.grant(request.resources)` — WebView 이중 권한 |
| mixedContent          | `never` — Kakao Maps 는 https 만 요청하므로 안전                                  |

## 5. 브리지 메시지 규약

방향: **Native → Web** (web 의 `window.postMessage` 이벤트 리스너에서 수신)

| type                | 페이로드                                                  | 용도                              |
| ------------------- | --------------------------------------------------------- | --------------------------------- |
| `FCM_TOKEN`         | `{ token: string }`                                       | 백엔드 등록용                     |
| `PUSH_NOTIFICATION` | `{ data: RemoteMessage }`                                 | 포그라운드 푸시 → toast 표시 등   |
| `LOCATION_UPDATE`   | `{ lat, lng, accuracy, timestamp }`                       | 현재 위치 주입                    |
| `LOCATION_ERROR`    | `{ code, message }`                                       | 권한 거부/타임아웃                |

방향: **Web → Native** (`window.ReactNativeWebView.postMessage` 로 송신)

| type             | 페이로드               | 용도                          |
| ---------------- | ---------------------- | ----------------------------- |
| `REQUEST_LOCATION` | -                    | 현재 위치 요청                |
| `OPEN_EXTERNAL`  | `{ url: string }`      | 외부 링크 시스템 브라우저 오픈|

## 6. 초기 native 프로젝트 생성

`apps/mobile/android`, `apps/mobile/ios` 디렉터리는 아직 없다. 다음 절차로 생성한다:

```bash
cd apps/mobile
# react-native init 은 RN 0.75 부터 deprecated → community CLI 사용
npx @react-native-community/cli@latest init TempForNative --version 0.85.2 --skip-install
# TempForNative/android, ios 디렉터리만 추출해 apps/mobile/ 로 이동
mv TempForNative/android android
mv TempForNative/ios ios
rm -rf TempForNative
```

`--version` 은 `apps/mobile/package.json` 의 `react-native` 와 반드시 일치해야 한다 (현재 `0.85.2`). 어긋나면 `android/build.gradle`, `Podfile`, AppDelegate 등이 깨진 빌드를 만든다.

이후:
1. `android/app/src/main/AndroidManifest.xml` 에 §2 권한 블록 추가
2. `ios/TriPick/Info.plist` 에 §2 키 추가
3. `ios/Podfile` 에 `use_modular_headers!`, FCM/Firebase pod 추가, `pod install`
4. Firebase Console 에서 `google-services.json` (Android), `GoogleService-Info.plist` (iOS) 각 위치에 배치

## 7. 검증

```bash
# Metro
pnpm --filter @tripick/mobile start

# 동시에 web/api 도 띄워야 WebView 가 화면을 받는다
pnpm --filter @tripick/api dev
pnpm --filter @tripick/web dev

# 디바이스/에뮬레이터
pnpm --filter @tripick/mobile android
pnpm --filter @tripick/mobile ios
```

수동 체크:
1. 앱 진입 시 `/trips` 노출
2. 카드 클릭 → `/planner` 진입, 상단 ← 버튼 + Android 백버튼으로 `/trips` 복귀
3. 위치 권한 다이얼로그 노출 (최초 1회)
4. 푸시 권한 다이얼로그 노출 + FCM 토큰이 Metro 로그에 찍히지 않더라도 web 측 postMessage 핸들러에서 수신 가능해야 함
5. `https://map.kakao.com` 같은 외부 도메인 링크 탭 시 시스템 브라우저로 이동

## 8. 후속 작업 (backlog)

- web 측 RN 브리지 컨슈머(`shared/lib/native-bridge.ts`) 구현 — 현재는 native 만 송수신 코드 가짐
- 백그라운드 위치/이탈 감지 단계에서 권한 확장
- preference-analyzer 사진 업로드 시 카메라/사진 권한 추가
- iOS 푸시 인증서 + APNs 토큰 페어링 + `@notifee/react-native` 채널 정의
- WebView 첫 로드 실패 시 retry UI (현재는 기본 white 화면)
