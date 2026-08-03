# 미도착 감지 알림 (Arrival-Check Alert) v1

문서 목적: 경로 이탈을 "자동 재계획"이 아니라 **날씨·혼잡과 동일한 알림**으로 다루는 미도착 감지 스케줄러를 추가한 작업을 고정한다. 이동 중 연속 이탈 판정 대신 **각 일정 항목의 시작 시각+유예에 사용자 최신 위치가 좌표 반경 밖이면** `arrival_alert` 를 보낸다. 판정은 서버가 하고, 위치는 클라이언트가 주기 보고한다. 기존 web 연속 이탈 감지(배너 confirm 신고, semi-manual)를 대체·제거했다(§8).

기준 브랜치: `feat/arrival-check-alert` (base: `develop`)
작성일: 2026-07-21
선행 문서: [`docs/alerts/weather-alert-scheduler-v1.md`](./weather-alert-scheduler-v1.md)·[`docs/alerts/crowd-alert-scheduler-v1.md`](./crowd-alert-scheduler-v1.md) (동형 스케줄러·미러링 원본), [`docs/trips/trip-progress-live-v1.md`](../trips/trip-progress-live-v1.md) (라이브 위치·이탈 감지 원본), [`docs/notification/inbox-and-trip-invite-v1.md`](../notification/inbox-and-trip-invite-v1.md) (인박스·푸시), [`docs/setup/mobile-webview-setup.md`](../setup/mobile-webview-setup.md) (RN 브리지·위치 추적)
관련 컨텍스트: [`CLAUDE.md`](../../CLAUDE.md) §3 미도착 감지→알림 플로우, §4 모듈 분리 기준, §7 "경로 이탈(미도착) 알림"

## 1. 범위

포함:

- 일정 항목 시작 시각+유예에 사용자 위치를 대조해 미도착을 감지하는 BullMQ 반복 잡(5분 주기)
- 감지 시 `arrival_alert` 인박스 알림 발송 (푸시 포함)
- (여행·사용자·일차)당 1회 발송 보장 (중복 억제)
- 실시간 위치 인제스트 엔드포인트(`POST /live/location`) + Redis 캐시
- 위치 보고 이원화 — 브라우저 단독은 웹, RN 앱은 네이티브(포그라운드·백그라운드)
- 기존 web 연속 이탈 감지(`detect-route-deviation`) 제거 (§8)

제외:

- **자동 재계획** — 의도적 제외. 재계획 큐를 주입받지 않아 구조적으로 불가능하다. 알림 탭 → planner 이동까지만, 거기서 재계획은 `manual`(§9)
- **이동 중 연속 이탈 판정** — 의도적 제외. "얼마나 벗어났나"는 판정이 불안정해, 일정 시작 시각의 **이산 체크**로 대체했다(§4)
- **위치의 플래닝 반영** — 위치는 미도착 판정에만 쓰고 일정 생성/재계획 점수에 넣지 않는다
- **iOS 완전 종료(force-stop) 커버** — foreground service 가 프로세스를 살리는 백그라운드까지만. OS 강제 종료는 내재적 한계(§9)

## 2. 배경 — 전달 경로 재사용, 신규는 감지·위치원

날씨·혼잡 알림 스케줄러가 이미 "감지 → 인박스/FCM → planner 이동" 경로를 완성해 뒀다. 이번 작업은 그 경로를 그대로 미러링하고, **위치 데이터원(실시간 위치 캐시)과 시작-시각 판정만** 새로 붙였다.

- 인박스 카테고리 `arrival_alert` 추가 → 액션 `open-trip`("일정 변경"), 수신 토글은 `replan_ready` 와 공유
- `rn-bridge` 푸시 라우팅에 `arrival_alert` → `/planner?tripId=` case 추가
- `ArrivalAlertModule` 은 `WeatherAlertModule`·`CrowdAlertModule` 과 동형(constants·module·processor·service)

기획도 이에 맞춰 정정했다 — 경로 이탈을 "자동 재계획" 서술에서 날씨·혼잡과 같은 "알림" 계열로 옮기고, 재계획은 사용자 확인 후 수동임을 명시([`CLAUDE.md`](../../CLAUDE.md) §1·§3·§7).

## 3. 데이터 흐름

```
[클라이언트] 여행 진행 중 위치 주기 보고
  브라우저 단독: 웹이 POST /live/location (하트비트 60초)
  RN 앱: 네이티브(App.tsx)가 foreground service 위치를 직접 POST (포그라운드·백그라운드)
         └ 웹은 access token + 절대 API base 만 LOCATION_AUTH 브리지로 넘김
  → LiveLocationService.record → Redis (live:location:<userId>, TTL 15분)

[cron */5 * * * * (KST)] BullMQ repeatable
  → ArrivalAlertProcessor
  → ArrivalAlertService.scanDueItems
      → 판정 대상 항목: scheduledAt ∈ [now-유예-지각상한, now-유예]   # 시작+유예를 막 지난 항목
      → 그 항목이 걸린 confirmed·in_progress 여행만 남김
      → 이른 항목부터, 여행별 수신자(owner+accepted) 각자:
          getFresh(userId, 10분)   # 위치 없음/오래됨이면 판정 스킵
          → haversine(위치, 좌표) - accuracy > 반경(500m) 이면 미도착
          → SET NX 로 (여행,사용자,일차) 발송 선점 (TTL: 그 일자 끝(KST)까지)
          → InboxService.create(arrival_alert)  # 인박스 + FCM
[앱] 알림 탭 → /planner?tripId= → 사용자가 직접 일정 변경
```

## 4. 판정 규칙 — 이동 중이 아니라 "시작 시각"에 이산 체크

이동 중 "얼마나 벗어났나"는 GPS 튐·경로 다양성 탓에 판정이 불안정하다. 그래서 **각 일정 항목의 시작 시각에 그 좌표 근처에 있는지**만 이산적으로 본다.

| 조건 | 값 | 이유 |
| ---- | -- | ---- |
| 판정 시점 | 시작 시각 + 유예 `ARRIVAL_GRACE_MIN`(15분) | 신호·주차·도보 접근을 감안, 정각 직후 오탐 방지 |
| 지각 상한 | 시작+유예 후 `ARRIVAL_LATE_LIMIT_MIN`(60분)까지만 | 더 늦은 항목은 사용자가 이미 접었다고 보고 안 알림(뒤늦은 알림은 잡음) |
| 도착 반경 | `ARRIVAL_RADIUS_M`(500m) | GPS 오차·주차장·넓은 관광지 부지 흡수 |
| 정확도 마진 | `distance - accuracy > 반경` 일 때만 알림 | 부정확한 fix 로 도착했는데 미도착 처리되는 오탐 방지(§6.4) |
| 위치 신선도 | 마지막 보고가 `LOCATION_STALE_MS`(10분) 이내 | 위치 없음/오래됨이면 판정 불가로 스킵 |
| 중복 억제 | 미선점 | (여행, 사용자, 일차)당 1회, TTL 은 그 일자 끝(KST)까지 |

판정은 **사용자별로 각자의 최신 위치**로 한다. 여행 멤버가 여럿이면 각자 위치로 판정해 근처인 사람은 빼고 먼 사람만 알린다. 위치를 한 번도 보고하지 않은 멤버는 판정 불가라 조용히 스킵한다.

임계값(유예 15분·반경 500m 등)은 현장 데이터 캘리브레이션이 필요한 초기값으로 상수에 명시했다.

## 5. 위치 보고 이원화 — 실행 환경으로 갈림

미도착 판정은 서버가 하지만, 위치 **소스**는 실행 환경에 따라 다르다. 핵심은 "웹뷰 JS 는 앱이 백그라운드로 가면 멈춘다"는 제약이다.

- **브라우저 단독**: 웹(`useReportLiveLocation`)이 `POST /live/location` 을 직접 호출한다.
- **RN 앱**: 네이티브(`App.tsx`)가 foreground service 로 잡은 위치를 **포그라운드·백그라운드 모두** 직접 POST 한다. 웹은 인증정보(access token + 절대 API base)만 `LOCATION_AUTH` 브리지로 넘기고 자체 보고는 하지 않는다(중복 방지).
  - access token TTL 이 7일이라 여행 세션 동안 리프레시 없이 유효하다. 토큰이 갱신되면 웹이 다시 브리지한다(§6.3).
  - Android 는 `LocationTrackingService`(foreground service, `foregroundServiceType=location`)가 Activity 파괴(앱 스와이프) 후에도 프로세스를 살려, RN JS 의 `fetch` 가 계속 동작한다.

**하트비트**: 위치 갱신은 이동 기반(네이티브 `minUpdateDistance` 10m, 웹 `distanceFilter`)이라 사용자가 멈추면 끊긴다. 그러면 서버 캐시가 stale 돼 "안 움직이는 no-show"(집에 그대로 있음)를 못 잡는다. 그래서 웹·네이티브 모두 **마지막 위치를 60초 주기로 재보고**해 캐시를 신선하게 유지한다(§6.1).

## 6. 설계 판단 (코드 리뷰에서 교정된 것 포함)

### 6.1 하트비트 재보고 — 정지 no-show 누락 방지 (리뷰 지적)

초기 구현은 "위치가 갱신될 때만" 서버로 보고했다. 그런데 위치 갱신이 이동 기반이라 사용자가 멈춰 있으면 보고가 끊기고, 캐시가 10분 지나 stale → 판정 스킵 → **정작 안 움직이는 no-show 를 못 잡는** 역설이 있었다. 웹은 `setInterval` 하트비트로, 네이티브는 마지막 위치를 보관해 하트비트 타이머로 재보고하도록 고쳐, 정지 상태에서도 서버 캐시를 신선하게 유지한다.

### 6.2 중복 억제 TTL — 그 일자 끝까지 (리뷰 지적)

초기 구현은 dedup TTL 을 고정 6시간으로 뒀는데, 하루 관광 일정은 6시간을 넘기기 일쑤라 오전에 알린 뒤 오후 항목에서 키가 만료돼 **같은 날 재알림**되던 문제가 있었다. 혼잡 알림과 동일하게 `toKstIsoDate`/`addDaysToIsoDate` 로 **그 항목의 KST 일자 끝(다음날 00:00 KST)까지** 남은 시간을 TTL 로 계산해, 하루가 길어도 (여행·사용자·일차)당 1회를 보장한다.

### 6.3 토큰 stale 방지 — 변경 시 재브리지 (리뷰 지적)

RN 에서 웹이 네이티브로 access token 을 넘기는 effect 가 `[enabled]` 에만 의존해, 웹 클라이언트가 401 로 토큰을 리프레시해도 네이티브는 **옛 토큰을 계속 써 백그라운드 POST 가 조용히 401 로 죽던** 문제가 있었다. 렌더마다 토큰을 읽어(SSR-safe) effect deps 에 넣어, 토큰이 바뀌거나 마운트 시 null→값으로 채워지면 다시 브리지한다.

### 6.4 GPS 정확도 마진 — 오탐 방지 (리뷰 지적)

반경 판정이 정확도(오차 반경)를 무시해, 셀타워 기반 저품질 fix(정확도 수백~수천 m)가 반경 밖에 떨어지면 실제로 도착했는데도 미도착으로 알리던 오탐이 있었다. 사용자의 실제 위치는 보고 지점에서 최대 `accuracy` 만큼 떨어져 있을 수 있으므로, **가장 가까웠을 수 있는 지점(`distance - accuracy`)마저 반경 밖일 때만** 확신하고 알린다. 정확도 미보고면 0 으로 본다.

### 6.5 `getReactNativeWebView` 공용 헬퍼 (리뷰 지적)

RN 웹뷰 감지 헬퍼가 `use-current-location`·`use-report-live-location`·`rn-bridge` 세 곳에 복붙돼 있었다. `shared/rn-bridge/rn-webview.ts` 로 추출해 한 곳에서 관리하도록 통합했다.

### 6.6 판정은 절대 시각 비교라 TZ-비의존

혼잡·날씨 알림은 "오늘"(KST) 날짜 판정이 필요해 `getKstParts` 를 썼지만, 미도착 판정은 `scheduledAt`(timestamptz)과 `now` 를 **절대 instant 로 비교**하므로 TZ 이슈가 없다. KST 가 필요한 곳은 dedup TTL 의 "일자 끝" 계산뿐이라 거기만 `toKstIsoDate` 를 쓴다.

### 6.7 중복 억제·부팅·repeatable

날씨·혼잡 알림과 동일 패턴을 그대로 미러링했다 — SET NX 발송 선점(재시도 중복 방지), Redis 장애 시 발송 유지(누락보다 중복), 반복 잡 등록을 백그라운드+백오프로 돌려 부팅 미차단, `@nestjs/schedule` 대신 BullMQ repeatable(다중 인스턴스 중복 방지). 위치 캐시용 Redis 클라이언트도 동형으로 자체 보유(장애 시 degrade). 상세는 [`weather-alert-scheduler-v1.md`](./weather-alert-scheduler-v1.md) §6 참조.

## 7. 검증

### 유닛 테스트 (`apps/api/test/arrival-alert/arrival-alert.service.spec.ts`, 14개)

- 시작+유예 후 반경 밖 → `arrival_alert` 발송 / 반경 안(도착) → 미발송
- 위치 없음·오래됨 → 판정 스킵 / active 아닌 여행 → 스킵 / 좌표 없는 항목 → 제외
- 사용자별 각자 위치 판정(근처인 사람 제외, 먼 사람만) / 이른 항목이 그날 선점(도배 방지)
- 발송 실패해도 선점 키 유지(재시도 중복 방지)
- 정확도 큰 fix 는 반경 밖이라도 미알림 / 정확한 fix 는 반경 밖이면 알림 (§6.4)
- dedup TTL 이 그 항목 KST 일자 끝까지 (§6.2)

### 타입·정적 검사

- `apps/api`·`apps/web`·`apps/mobile` `tsc --noEmit` 통과
- API 유닛 전체 327개 통과 (기존 회귀 없음)

## 8. 기존 web 연속 이탈 감지 제거 (semi-manual → 서버 판정)

미도착 알림이 "근처에 있나"를 서버가 판정하므로, 이동 중 배너를 띄우고 사용자가 confirm 을 눌러야 신고되던 **반응형 web 연속 이탈 감지**를 제거했다.

- **제거**: `features/detect-route-deviation`(연속 haversine 감지 훅 + `DeviationBanner`), 웹 `reportTripDeviation`(→ `/alternative/deviation`) 호출
- **대체**: `features/report-live-location`(위치 서버 보고), 서버측 `ArrivalAlertModule` 판정
- **유지**: 백엔드 `/alternative/deviation` 엔드포인트·`trigger:'deviation'` 재계획 경로는 그대로(수동 재계획 진입점). trip-progress 뷰의 다음 장소 거리 표시는 인라인 haversine 으로 대체

## 9. 알려진 한계 / 후속 작업

- ~~**"수락 → 재계획" 미배선**~~ — 해소됨. 알림 딥링크가 `trigger:'deviation'` 을 실어 planner 배너로 제안한다(자동 재계획은 여전히 없음): [`docs/alerts/alert-replan-wiring-v1.md`](./alert-replan-wiring-v1.md). 위치도 해소 — `ReplanningService.enqueue` 가 미도착 판정에 쓰는 위치 캐시를 `deviation` 재계획 잡에 실어 준다(같은 문서 §8). 쓰이지 않던 `deviatedItemId` 는 제거
- **iOS 백그라운드** — Android 는 foreground service 로 백그라운드·앱 스와이프까지 커버하지만, iOS 는 네이티브 추적 모듈이 없어 `watchPosition` + `UIBackgroundModes(location)` 폴백뿐이다. 앱 완전 종료 시 위치가 끊긴다. iOS significant-location-change 등은 후속
- **임계값 캘리브레이션** — 유예 15분·반경 500m·신선도 10분은 초기값. 실제 발송량을 보고 튜닝 필요
- **force-stop / OS 강제 종료** — 프로세스가 죽으면 어떤 보고도 못 한다. 내재적 한계로 문서화만
- **cron TZ 일관성** — `arrival-alert` 는 `tz:'Asia/Seoul'` 명시. `weather-alert` 잠재 이슈는 여전히 범위 밖

## 10. 변경 파일

```
apps/api/src/arrival-alert/arrival-alert.service.ts          (신규) 시작시각 판정·발송 스캔
apps/api/src/arrival-alert/live-location.service.ts          (신규) 위치 Redis 캐시 + dedup 선점
apps/api/src/arrival-alert/live-location.controller.ts       (신규) POST /live/location
apps/api/src/arrival-alert/dto/update-live-location.dto.ts   (신규) 위치 보고 DTO
apps/api/src/arrival-alert/arrival-alert.module.ts           (신규) repeatable 등록 + 컨트롤러
apps/api/src/arrival-alert/arrival-alert.processor.ts        (신규) 잡 워커
apps/api/src/arrival-alert/arrival-alert.constants.ts        (신규) cron·유예·반경·TTL 상수
apps/api/src/app.module.ts                                   (ArrivalAlertModule 등록)
apps/api/src/inbox/inbox.service.ts                          (arrival_alert 액션)
apps/api/src/users/users.service.ts                          (prefersCategory remap)
apps/api/src/users/notification-preferences.constants.ts     (기본 수신값)
packages/types/src/inbox.ts                                  (arrival_alert 카테고리)
packages/types/src/live-location.ts                          (신규) UpdateLiveLocationDto
packages/types/src/user.ts, index.ts                         (기본 수신값·배럴)
apps/web/src/features/report-live-location/                  (신규) 위치 서버 보고 훅
apps/web/src/shared/rn-bridge/rn-webview.ts                  (신규) getReactNativeWebView 공용
apps/web/src/shared/api/client.ts                            (apiBaseUrl 절대화 헬퍼)
apps/web/src/shared/location/use-current-location.ts         (공용 헬퍼 사용)
apps/web/src/shared/rn-bridge/rn-bridge.tsx                  (arrival_alert 라우팅 + 공용 헬퍼)
apps/web/src/views/inbox/ui/inbox-view.tsx                   (미도착 알림 렌더)
apps/web/src/views/trip-progress/ui/trip-progress-view.tsx   (감지 제거 + 위치 보고 연결)
apps/web/src/entities/trip-plan/api.ts, index.ts             (reportLiveLocation)
apps/mobile/src/App.tsx                                      (LOCATION_AUTH 브리지 + 직접 POST + 하트비트)
- 제거(§8): features/detect-route-deviation (감지 훅·배너·배럴)
```

환경변수 추가 없음 — 기존 `REDIS_HOST`, `REDIS_PORT` 와 클라이언트의 `NEXT_PUBLIC_API_URL` 을 그대로 쓴다.
