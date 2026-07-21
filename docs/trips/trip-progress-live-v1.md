# 여행 진행(Live) 화면 v1

문서 목적: 여행 시작일이 되면 진입하는 실시간 "여행 중" 화면을 끝에서 끝까지 연결한 작업을 고정한다. 위치 추적(웹·RN·네이티브 foreground service), 서버 파생 진행상태, 경로 이탈 자동 감지, 웨이팅/이탈 신고, 재계획 결과 수신·표시까지를 정리한다.

기준 브랜치: `feat/trip-progress`
작성일: 2026-06-30
관련 문서: [`docs/planner/realtime-websocket-v1.md`](../planner/realtime-websocket-v1.md) (replan 수신 인프라·게이트웨이 보안), [`docs/planner/main-planner-v1.md`](../planner/main-planner-v1.md) (Planner trip DTO), [`docs/setup/mobile-webview-setup.md`](../setup/mobile-webview-setup.md) (RN WebView 셸·FCM)

## 1. 범위

포함:

- `/trip/live` 라우트 + `views/trip-progress` (진행 중 여행 없으면 다가오는 여행 안내)
- 위치 추적: 브라우저 `watchPosition` 폴백 + RN WebView 브리지 + **Android foreground service 네이티브 모듈**
- 서버 KST 기준 **여행 진행상태 파생 필드**(`currentDay`·`status`) — 클라 startDate 계산 제거
- 경로 이탈 **자동 감지**(haversine 연속 초과) → 확인 배너 → `/alternative/deviation` 신고
- 웨이팅 신고 시트 — **owner + accepted 멤버** 모두 가능하도록 BE 인가 확장
- 재계획 결과 실시간 수신(단일 구독) → 일정 캐시 무효화 + 진행 핀 + 결과 토스트
- 다음 장소 ETA·거리 바, 위치 권한 안내 배너
- 반응형(모바일 풀스크린 셸 / 태블릿·PC 좌측 네비 + 지도 + 우측 일정 패널)

제외:

- BullMQ replan 워커의 실제 LLM/RAG 대안 생성 품질 (AI 레이어 별도)
- 재계획 완료 시 FCM 푸시 발송(BE Notification 연동) — 수신부(index.js 핸들러)만 준비됨
- 동행 멤버 실시간 위치 공유
- 기상청 실시간 날씨 배너 (`meta.weather` 는 placeholder)
- Android foreground service 의 실기기 빌드·동작 검증 (코드만 작성)

## 2. 아키텍처 흐름

```
[trip-progress-view] mount (active trip 존재 시)
  → useCurrentLocation()         위치 (RN 브리지 | watchPosition)
  → useTripProgress(itemsForDay) 시각 기준 done/current/upcoming + nextItem
  → useDeviationDetection()      haversine(position, nextPlace) 연속 초과 → 배너
  → useReplanSubscription(tripId) join-trip → replan_result → 캐시 무효화
        ├ NextStopBar            다음 장소까지 약 N분 · 거리
        ├ LocationPermissionBanner  권한 denied/unavailable 안내
        ├ ReplanningPill         pending/processing 동안 "AI 재계획 중"
        └ ReplanToast            결과/접근거부 토스트 (구독 공유)

[RN WebView shell]  (apps/mobile)
  START_LOCATION_TRACKING → Android: 네이티브 FG service | iOS: watchPosition
  → LOCATION_UPDATE 스트리밍 → Web 으로 postMessage
```

## 3. 서버 — 여행 진행상태 파생 필드

오늘이 며칠차인지를 클라가 `meta.startDate` 로 계산하던 로직을 서버 KST(+09:00) 파생으로 이전했다. 마이그레이션 없이 trip 조회 시 계산한다.

`packages/types/src/main-planner.ts`

- `PlannerTripProgressDto` 추가: `status`(`upcoming`·`ongoing`·`done`·`draft`) / `currentDay`(1-based, 클램프) / `totalDays` / `serverTime`(ISO)
- `PlannerTripDto` 에 `progress` 필드 추가

`apps/api/src/main-planner/main-planner.service.ts`

- `tripProgress(trip, totalDays)` 헬퍼 — 기존 `summaryStatus`/`isoDate`(이미 KST 기준) 재사용해 `currentDay`·`status` 계산
- `toPlannerTrip` 반환부에 `progress` 포함
- PlannerTripDto 는 이 서비스 한 곳에서만 생성돼 다른 목/픽스처 영향 없음

FE: `trip-progress-view.tsx` 의 `dayNumber` 가 `trip.progress.currentDay` 를 신뢰(클라 `startOfDay` 파생 제거).

## 4. 서버 — 멤버 신고 인가 확장

웨이팅/이탈 신고(`/alternative/*` → `ReplanningService.enqueue`)가 owner 만 허용해 멤버는 `Forbidden` 이었다. 실시간 세션 참여와 동일 기준으로 통일했다.

`apps/api/src/replanning/replanning.service.ts`

- `trip.userId !== userId` 직접 비교 → `TripMembersService.canAccessTrip(tripId, userId)`(owner + accepted 멤버) 사용
- 더 이상 안 쓰는 `TripEntity`/`InjectRepository`/`NotFoundException` 의존성 제거

`apps/api/src/replanning/replanning.module.ts`

- `TypeOrmModule.forFeature([TripEntity])` → `TripMembersModule` import 교체
- 순환참조 없음: AlternativeModule → ReplanningModule → TripMembersModule

동작 변화: 존재하지 않는 tripId 는 기존 `404` → `403`(존재 여부 비노출, 인가 관점에서 타당).

## 5. FE — 화면 구성

`apps/web/src/views/trip-progress/ui/trip-progress-view.tsx`

- `splitTripSchedule` 로 active/upcoming 분리. active 없으면 `TripProgressEmpty`(진행 중 없음 + 다가오는 여행 리스트)
- 반응형 두 레이아웃:
  - 모바일(`< lg`): 헤더 + 고정 지도(280px) + 스크롤 일정 + 하단 네비
  - 태블릿·PC(`≥ lg`): 좌측 네비 + 큰 지도(main) + 우측 일정 패널(aside)
- 지도 영역은 고정, 일정만 스크롤. 로드 시 현재 시간대 항목으로 auto-scroll
- 일정 탭 → 해당 좌표로 지도 중심 이동(`focusCoord`), 현재 위치 버튼으로 복귀

위젯:

- `widgets/live-map` — 일정 마커 + 현재 위치 마커, 현재 위치 버튼, 선택 항목 포커스(고정 줌 레벨)
- `widgets/trip-progress-timeline` — done/current/upcoming 레일, 선택 강조, 항목별 웨이팅 신고 버튼

## 6. FE — 위치 추적

`apps/web/src/shared/location/use-current-location.ts`

- RN WebView 면 `START_LOCATION_TRACKING` 송신 후 네이티브 `LOCATION_UPDATE` 수신, 언마운트 시 `STOP_LOCATION_TRACKING`
- 브라우저면 `navigator.geolocation.watchPosition` 폴백
- 두 경로를 동일 `GeoPosition`(`source: 'rn' | 'browser'`)으로 정규화, `permission`·`error` 도 반환

`LocationPermissionBanner` (`shared/location/ui`) — `permission` 이 `denied`/`unavailable` 일 때 안내(닫기 가능, 회복 시 리셋). 기존엔 `position` 만 쓰고 버려지던 상태를 소비.

## 7. FE — 진행·이탈·재계획

- `features/track-trip-progress` — `useTripProgress`(시각 기준 파생, 1분 갱신), `NextStopBar`/`estimateEtaMinutes`(이동수단별 속도로 ETA 근사, 거리 포맷). 거리는 이탈 감지의 haversine 값 재사용
- `features/detect-route-deviation` — `useDeviationDetection`(임계 400m 연속 3회 초과 → `deviated`), `DeviationBanner`(확인 시 `/alternative/deviation` 신고, 무시 시 같은 장소 동안 숨김)
- `features/report-waiting` — `WaitingReportSheet`(항목·위치 첨부 신고)
- `features/subscribe-replan-result` — `useReplanSubscription`(join-trip ack·`replan_result` 수신·캐시 무효화), `ReplanToast`. **단일 구독**: 뷰가 구독을 소유하고 진행 핀(`ReplanningPill`)과 토스트가 공유하도록 `ReplanToast` 에 선택적 `subscription` prop 추가(없으면 자체 구독 — planner-view 호환 유지)

## 8. RN — 연속 위치 추적 + 네이티브 권한

`apps/mobile/src/App.tsx`

- `START/STOP_LOCATION_TRACKING` 브리지 처리 추가(기존 단발 `REQUEST_LOCATION` 호환 유지)
- Android: 네이티브 `LocationTracking` 모듈 우선(`NativeEventEmitter` 로 `TripickLocationUpdate`/`Error` 수신), iOS·폴백: `watchPosition`(distanceFilter 10m)
- 권한 플로우: fine/coarse(+POST_NOTIFICATIONS) 요청 → fine 승인 시 `ACCESS_BACKGROUND_LOCATION` **별도** 요청(rationale 다이얼로그)

네이티브 설정:

- `AndroidManifest.xml` — INTERNET 외 위치 권한이 아예 없던 버그 수정. fine/coarse/background-location/foreground-service/POST_NOTIFICATIONS 선언 + `<service foregroundServiceType="location">`
- `ios/TriPick/Info.plist` — When-in-use 문구 + `NSLocationAlwaysAndWhenInUseUsageDescription` + `UIBackgroundModes`(location, remote-notification)

### Android foreground service 모듈 (`android/.../location/`)

- `LocationTrackingService.kt` — `foregroundServiceType=location` 지속 알림만 유지(백그라운드 위치 허용 조건 충족), Android 14+ 3-arg `startForeground` 분기
- `LocationTrackingModule.kt` — FusedLocationProvider 로 구독(고정밀·5s·10m), `TripickLocationUpdate`/`Error` 이벤트 emit, `SecurityException` 방어
- `LocationTrackingPackage.kt` — ReactPackage, `MainApplication.kt` 에 수동 등록(autolink 불가)
- `app/build.gradle` — `play-services-location:21.3.0` 명시(앱 모듈 노출용)

한계: 화면 꺼진 채 장시간 추적은 background-location 권한 승인 + FG service 동작이 전제. Kotlin 컴파일·실기기 검증은 미수행(`./gradlew assembleDebug` 직접 필요).

## 9. 인프라 수정

`packages/types`·`packages/utils` 의 커밋된 stale `.js` 빌드 산출물이 ts-node + tsconfig-paths 에서 `.ts` 보다 우선 로드돼, 시드 스크립트의 `notificationPreferences` jsonb default 가 깨지던 문제 해결(산출물 삭제 + gitignore + 재빌드).

## 10. 검증

- `apps/api` / `apps/web` typecheck 통과, `apps/web` 프로덕션 빌드 통과
- `apps/mobile` typecheck 통과
- 데모 계정에 오늘자 당일치기(6개 항목) Live 시드(`apps/api/src/scripts/seed-demo-live.ts`)로 화면 확인
- 미검증: Android 네이티브 빌드·실기기 위치 동작, replan 워커 실제 대안 생성

## 11. 후속 작업

- 재계획 완료 → FCM 발송(BE Notification 연동)으로 백그라운드 알림 닫기
- 동행 멤버 실시간 위치 공유(WebSocket 위치 브로드캐스트)
- 기상청 연동으로 `meta.weather` 실데이터 + 우천 시 실내 일정 추천 배너
- Android FG service 실기기 검증 + iOS Always 권한 백그라운드 수신 확인
