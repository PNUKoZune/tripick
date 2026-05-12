# TriPick Mobile (React Native WebView) v1 setup

문서 목적: `apps/mobile` 의 React Native 셸이 Next.js 웹앱을 WebView 로 렌더링하기 위해 필요한 권한, 매니페스트 키, pnpm 모노레포 설정, 브리지 메시지 규약을 한 곳에 정리한다.

기준 브랜치: `chore/mobile-setup`
기준 RN: `0.85.x` + `react-native-webview ^13`, `@react-native-firebase/messaging ^24`, `react-native-geolocation-service ^5`

## 1. 책임 분리

- **Native (React Native 셸)**: WebView 렌더, OS 권한 요청, FCM 토큰 발급/푸시 수신, Geolocation 획득, 하드웨어 백버튼, 외부 링크 위임
- **Web (Next.js)**: 모든 UI/도메인 화면, REST/WebSocket 통신, 카카오맵 SDK 로드
- Native 는 도메인 UI 를 직접 그리지 않는다. 정보는 `window.postMessage` 로 web 에 전달, web 은 `window.ReactNativeWebView.postMessage(...)` 로 native 에 요청한다.

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

푸시 사용 시 Xcode `Signing & Capabilities` 에서 **Push Notifications** 추가, `aps-environment` 자동 주입.

## 3. v1 에서 아직 추가하지 않는 권한 (backlog)

- `ACCESS_BACKGROUND_LOCATION` (Android) / `NSLocationAlwaysAndWhenInUseUsageDescription` (iOS) — 백그라운드 경로 이탈 감지
- `CAMERA` / `NSCameraUsageDescription` — 추후 preference-analyzer 사진 업로드
- `READ_MEDIA_IMAGES` (Android 13+) / `NSPhotoLibraryUsageDescription` (iOS) — 동일

## 4. App.tsx 동작 요약

[apps/mobile/src/App.tsx](../apps/mobile/src/App.tsx)

| 동작                  | 설명                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| 진입 URL              | DEV: `http://10.0.2.2:3000/` (Android) / `http://localhost:3000/` (iOS). `/trips` 머지 후 변경 |
| 권한 요청             | mount 시 위치 + Android 13+ 푸시 권한 일괄 요청                                   |
| FCM                   | `messaging().requestPermission()` → `getToken()` → web 으로 `FCM_TOKEN`. Firebase 자격 파일 미배치 시 `console.warn` 후 정상 건너뜀 |
| Geolocation           | web 에서 `REQUEST_LOCATION` 메시지 받으면 `getCurrentPosition` 결과를 web 으로 주입|
| Android 백버튼        | WebView 히스토리 있으면 `goBack()`, 없으면 OS 기본 동작(앱 종료)                  |
| 외부 링크             | WebView origin 외 URL 은 `Linking.openURL` 로 시스템 브라우저 위임                |
| Android geolocation   | `onPermissionRequest` 에서 `request.grant(request.resources)` — Platform 분기로 `androidOnlyProps` spread |
| mixedContent          | `never` — Kakao Maps 는 https 만 요청하므로 안전                                  |

### 알려진 Fabric 제약

- `decelerationRate` prop 은 RN 0.85 새 아키텍처에서 String→Double 자동 변환이 깨져 있다 → 사용 X (기본값으로 두기)
- `onPermissionRequest` 는 react-native-webview 13.x 타입 union 에 빠져 있어 `Platform.OS === 'android'` 분기에서 별도 객체로 spread

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

## 6. pnpm 모노레포 설정

RN 은 monorepo + pnpm 의 symlink 구조와 잘 맞지 않는다. 다음 셋이 필수다.

### 6-1. `apps/mobile/metro.config.js`

- `watchFolders: [workspaceRoot]` — `@tripick/types` 등 workspace 패키지 변경 감지
- `resolver.nodeModulesPaths` — mobile 로컬 + workspace root 양쪽 노출
- `resolver.unstable_enableSymlinks: true` — pnpm `.pnpm/<pkg>/node_modules/<pkg>` 트리를 Metro 가 따라가게 함. 이게 꺼지면 react-native 내부의 `require('invariant')` 같은 transitive 가 해석 실패
- `resolver.unstable_enablePackageExports: true` — package.json `exports` 인식
- hierarchical lookup 은 그대로 둔다 (꺼두면 sibling dep 해석이 깨진다)

### 6-2. transitive deps 명시

`react-native` 가 transitive 로 끌고 오는 패키지 중 pnpm 이 `apps/mobile/node_modules/` 에 symlink 를 만들지 않는 것들은 빌드 시 explicit lookup 이 필요해 직접 의존성으로 등록한다:

```jsonc
// apps/mobile/package.json
"devDependencies": {
  "@react-native/babel-preset": "0.85.2",
  "@react-native/codegen": "0.85.2",       // codegen CLI 가 빌드 중 호출됨
  "@react-native/eslint-config": "0.85.2",
  "@react-native/gradle-plugin": "0.85.2", // settings.gradle 의 includeBuild 가 가리킴
  "@react-native/metro-config": "0.85.2",
  "@react-native/typescript-config": "0.85.2"
}
```

### 6-3. `apps/mobile/tsconfig.json` self-contained

TS 6 pre-release 의 `extends` 해석이 pnpm symlink + `customConditions` 조합에서 깨진다. base 를 inline 으로 옮긴 self-contained 형태로 둬서 IDE 와 `tsc` 양쪽이 안정 동작하도록 한다 (`baseUrl` 은 TS 6 에서 deprecate 되어 `paths` 만 사용).

### 6-4. `apps/mobile/babel.config.js`, `apps/mobile/react-native.config.js`

- babel: `module:@react-native/babel-preset` 단일 preset
- react-native.config: iOS/Android 소스 디렉터리 명시(`./ios`, `./android`). RN CLI 가 native 프로젝트 자동 탐색 시 사용

## 7. native 프로젝트 (android, ios)

초기 생성:

```bash
cd apps/mobile
# react-native init 은 RN 0.75 부터 deprecated → community CLI 사용
npx @react-native-community/cli@latest init TempForNative --version 0.85.2 --skip-install
mv TempForNative/android android
mv TempForNative/ios ios
rm -rf TempForNative
```

`--version` 은 `apps/mobile/package.json` 의 `react-native` 와 반드시 일치해야 한다 (현재 `0.85.2`).

이후 정리:
1. `TempForNative` → `TriPick` 일괄 rename (폴더, `.xcodeproj`, `.xcscheme`, 내부 문자열, `com.tempfornative` 패키지 폴더)
2. `android/app/src/main/AndroidManifest.xml` 에 §2 권한 블록 추가
3. `ios/TriPick/Info.plist` 에 §2 키 추가
4. `ios/Podfile` 에 `use_modular_headers!`, FCM/Firebase pod 추가, `pod install`
5. Firebase Console 에서 `google-services.json` (Android), `GoogleService-Info.plist` (iOS) 발급 → 해당 경로에 배치 (둘 다 `.gitignore` 됨)

`apps/mobile/.gitignore` 에 RN 표준 ignore 패턴 등록 (build/, .gradle/, Pods/, xcuserdata, Firebase 자격 파일 등). 루트 `.gitignore` 의 `/android`, `/ios` 는 standalone RN 프로젝트 잔재라 제거했다.

## 8. 루트 스크립트

```jsonc
// package.json
"scripts": {
  "dev": "turbo run dev",                                           // web + api + types + utils
  "dev:mobile": "pnpm --filter @tripick/mobile start",              // Metro 만
  "dev:android": "pnpm --filter @tripick/mobile android",           // 빌드 + 설치 + Metro
  "dev:ios": "pnpm --filter @tripick/mobile ios"                    // Mac 만
}
```

mobile 은 `dev` task 에 안 들어간다. 디바이스 없으면 Metro 가 idle 자원만 차지하기 때문.

## 9. WSL2 개발 환경 (Windows 호스트)

호스트가 Windows 일 때 다음 조합이 마찰 적다.

- **WSL**: JDK 17 + Android cmdline-tools + platform-tools 설치, gradle/Metro 모두 WSL 안에서 실행
- **Windows**: Android Studio 는 **AVD Manager 만** 사용 (에뮬레이터 띄우기). IDE 는 WSL UNC 경로에 쓰기 권한 못 가져서 충돌
- **adb 브리지**: `ADB_SERVER_SOCKET=tcp:<Windows IP>:5037` 환경변수로 WSL adb 가 Windows adb 서버에 위임. `adb -a -P 5037 nodaemon server start` 를 Windows PowerShell 에서 띄워야 외부 접속 허용

### Android SDK 경로

Windows 사용자명에 한글이 있으면 기본 SDK/AVD 경로(`C:\Users\<한글>\.android\...`)에서 qemu 가 조용히 죽는다. ASCII-only 경로(`C:\Android\Sdk`, `C:\Android\avd`)로 옮기고 `ANDROID_AVD_HOME`, `ANDROID_USER_HOME` 환경변수 설정.

### 포트 포워딩

빌드 후 white screen 일 때:
```bash
adb reverse tcp:8081 tcp:8081   # Metro
adb reverse tcp:3000 tcp:3000   # Web
adb reverse tcp:4000 tcp:4000   # API
```

## 10. 검증

```bash
# 4개 터미널
pnpm --filter @tripick/api dev
pnpm --filter @tripick/web dev
pnpm dev:mobile
pnpm dev:android
```

수동 체크:
1. 앱 진입 → 위치/푸시 권한 다이얼로그 노출
2. 웹앱 루트(`/`) 가 WebView 에 렌더 (planner v1 머지 후엔 `/trips` 로 ENTRY_PATH 변경)
3. Android 백버튼 / iOS 좌측 스와이프 → WebView 히스토리 이동
4. 외부 도메인 링크 탭 시 시스템 브라우저로 이동
5. Firebase 자격 미배치 상태에선 Metro 로그에 `[TriPick] FCM 초기화 생략` 만 찍히고 앱은 정상 동작

## 11. 후속 작업 (backlog)

- planner v1 (`/trips`, `/planner`) 머지 후 `ENTRY_PATH` 갱신
- web 측 RN 브리지 컨슈머(`shared/lib/native-bridge.ts`) 구현 — 현재는 native 만 송수신 코드 가짐
- iOS Bundle Identifier 도메인 확정 (`org.reactjs.native.example.TriPick` → 실제)
- Android `applicationId` 도메인 확정 (`com.tripick` → 실제)
- release keystore 분리 (현재 release 가 debug keystore 로 fallback)
- 백그라운드 위치/이탈 감지 단계에서 권한 확장
- preference-analyzer 사진 업로드 시 카메라/사진 권한 추가
- iOS 푸시 인증서 + APNs 토큰 페어링 + `@notifee/react-native` 채널 정의
- WebView 첫 로드 실패 시 retry UI
