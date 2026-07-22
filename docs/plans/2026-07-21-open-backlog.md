# TriPick 미처리 백로그 트래킹

문서 목적: 각 기능 문서(`*-v1`)의 후속/백로그 섹션을 모아, 아직 안 된 항목만 체크박스로 추적한다. CLAUDE.md 기획 범위와 대조해 계획 밖 항목은 제외했다.

작성일: 2026-07-21
기준선: 최신 문서 `arrival-check-alert-v1`(2026-07-21)까지. `[코드확인]` = 미처리 여부를 코드로 대조한 항목.
관련 문서: [docs/README.md](../README.md) (문서 인덱스), [CLAUDE.md](../../CLAUDE.md) (기획 범위·non-goal)

## 상태 표기

체크박스는 "완료/미완료"만 나타내므로, 미완료 항목의 성격을 태그로 구분한다.

- `- [ ]` 할 일(열림) · `- [x]` 완료
- `[대기: <조건>]` — 선행·외부 조건(라이브 배포·실기기·도메인 확정 등) 충족 전엔 착수 불가. 우리 판단이 아니라 조건 문제
- `[보류: <이유>]` — 지금은 **의도적으로** 미진행. 우선순위·리스크·비용 판단으로 패스한 것. 체크박스는 열어두되 왜 지금 안 하는지를 남긴다
- `[제외: <이유>]` — 프로젝트 성격이나 기획적으로 맞지 않는 항목, 체크박스를 닫고 그 이유를 남긴다.
- `[코드확인: …]` — 미처리 여부를 코드로 대조한 항목

> 새 항목도 같은 규칙으로 태그. 태그 없는 `- [ ]` 는 "그냥 아직 안 함(하면 됨)".

---

## 공통 · 여러 문서에 반복 (우선순위 후보)

- [ ] **"수락 → 재계획" 배선** `[코드확인: 없음]` — `deviation`/`weather` 트리거 타입·프롬프트·결과분기는 준비됨. 알림 탭 → planner 이동 후 재계획 진입점만 없음 ([arrival](../alerts/arrival-check-alert-v1.md#L142)·[crowd](../alerts/crowd-alert-scheduler-v1.md#L143)·[mid-term](../alerts/mid-term-forecast-v1.md#L113))
- [ ] **iOS 푸시(APNs) 실기기 검증** `[대기: 실기기 + APNs Auth Key]` — Auth Key 업로드 + Xcode capability ([inbox](../notification/inbox-and-trip-invite-v1.md#L450)·[photo-taste](../preference/preference-photo-taste-analysis-v1.md#L152)·[trip-progress](../trips/trip-progress-live-v1.md#L147)·[mobile](../setup/mobile-webview-setup.md#L226))
- [x] **Web Push (Service Worker + VAPID)** — 브라우저 단독 사용자 푸시 수신 ([web-push](../notification/web-push-service-worker-v1.md)). 자동 권한 프롬프트→옵트인 UI, `platform='web'` 정밀 태깅은 후속
- [ ] **DB 마이그레이션 인프라** `[코드확인: 없음]` `[대기: 라이브 스키마 반영 결정]` — `synchronize` 의존, 라이브 스키마 반영 미결 ([preferences-enh](../preference/preferences-enhancements-v1.md#L111)·[weighting](../preference/preference-embedding-weighting-v1.md#L94))
- [x] **지도 폴리라인 동선 시각화** `[코드확인: 없음]` `[제외: 폴리라인 동선은 오히려 UI 상으로 불편할 수 있음]` — 내 위치 이동 버튼 포함 ([main-planner](../planner/main-planner-v1.md#L263)·[planner-enh](../planner/planner-page-enhancements-v1.md#L124))

## 플래너 · 실시간

- [x] `report-deviation` WS 채널 제거 `[코드확인]` — 송신부 없음 + 수신부는 `ArrivalAlertModule`(서버 스캔)로 대체돼 사문화. 인증만 하고 멤버십은 안 보던 핸들러라 제거가 곧 인가 갭 해소 ([realtime](../planner/realtime-websocket-v1.md#L80))
- [x] replan 워커가 실제 `pushReplanResult` 호출 `[코드확인]` — [alternative.processor.ts](../../apps/api/src/alternative/alternative.processor.ts) 성공·실패 양쪽 호출 + inbox/FCM 폴백
- [x] 게이트웨이 인가: room 재입장/멤버십 변경 시 재검증 `[코드확인]` — 재입장은 `join-trip` 마다 `canAccessTrip` 재검증(기존), 멤버 제거 시 `evictFromTrip` 으로 소켓 즉시 퇴장(신규)
- [x] 트립 레벨 재계획 진입점 `[코드확인]` — 데스크탑 헤더 "AI 재계획" 버튼 + 모바일 FAB → ReplanModal(manual) ([alternative](../planner/alternative-place-picker-v1.md#L142))
- [x] 대안 swap 시 영업시간 위반 경고 `[코드확인]` — 후보 영업시간을 일정 항목 방문 시각과 대조해 `closedAtScheduled` 신호를 카드에 노출(swap 전 경고). `PlannerAlternativeDto.openingHours`/`closedAtScheduled` 추가
- [x] 현재 장소 비교 카드(P3-9) → 대안 카드 취향 근거(reason) 정식 노출로 대체 `[코드확인]` — 좌우 비교 카드는 BottomSheet 세로 레이아웃에 부적합. `place.reason` 을 `waitLabel` 에 욱여넣던 것을 `PlannerAlternativeDto.reason` 전용 필드로 분리해 카드에 한 줄 노출
- [x] pending/resolve 후보 마커 좌표 정규화 일관화 `[코드확인]` — 추천/resolve 응답 마커를 병합 후 `normalizeMarkerPositions` 로 폴백 x·y 재정규화(SDK 미로딩 미리보기 정합)
- [x] 필수 포함 장소 LLM 경로 보장 주입(구 best-effort) `[코드확인]` — `enforceMustInclude` 로 LLM/폴백 계획에서 누락된 필수 장소를 음수 order 로 강제 주입해 일차별 slice 에서 살아남게 보장 ([planner-enh](../planner/planner-page-enhancements-v1.md#L124))
- [x] 검색 드롭다운 키보드 내비 · 태블릿 사이드바 접힘 localStorage `[코드확인]` — combobox/listbox + 방향키·Enter·Esc, 사이드바 접힘 상태 localStorage 유지

## 라우팅

- [ ] `departAt` 지원 `[코드확인: 없음]` `[보류: Live 폴링 소비자 부재 + ODsay 기본 API 미지원]` — 심야 대중교통 ETA 오차. searchPubTransPathT 는 출발 시각 파라미터 자체가 없어 캐시키 확장만으론 못 잡고 다른 엔드포인트 전환이 필요 ([routing](../planner/routing-external-api-v1.md#L199))
- [ ] in-flight 병합 Redis 락 `[보류: 단일 인스턴스]` — 스케일아웃 시 인스턴스 간 중복. 그전엔 캐시 TTL 로 bound 되어 순이득 미미
- [x] ODsay 쿼터 폴백 지표화 `[코드확인]` — `RouteHelper.fallback` 단일 통로에서 이동수단·사유별 계수(`getFallbackMetrics`) + 이상 신호만 warn. 쿼터 초과는 전용 코드가 없어 500 계열 `quota_or_server` 버킷으로 잡히며 급증이 곧 신호 ([routing](../planner/routing-external-api-v1.md#L204))
- [ ] `ODSAY_SERVICE_URL` 실제 등록 도메인으로 교체 `[대기: 라이브 배포]`
- (도보 직선거리 추정은 내재적 한계 — 아래 §내재적 한계 참고)

## 알림 · 날씨 · 혼잡

- [x] 예보 악화 시 재알림(선점 키에 확률 저장) `[제외: 알림 피로]` — 재알림은 사용자에게 알림이 잦아 오히려 불편. (여행, 일자)당 1회 유지 ([weather-alert](../alerts/weather-alert-scheduler-v1.md#L130))
- [x] 일차 딥링크(푸시 payload `day` 반영) `[코드확인]` — 세 알림(weather/crowd/arrival)의 open-trip action 에 `day` 주입 → `/planner?tripId=X&day=N` → PlannerView 초기 일차. 스테일 일차는 기존 effect 가 첫 일차로 폴백
- [x] 날씨/재계획 알림 수신 토글 분리 `[코드확인]` — `prefersCategory` 의 weather/crowd/arrival→replan_ready collapse 제거, 각 카테고리가 자기 키를 따름. 설정 UI 는 "재계획 완료"(replan_ready)와 "날씨·혼잡·미도착 추천"(weather_alert 대표, crowd·arrival 동반) 2개 row 로 분리. 기존 replan_ready off 사용자는 이제 추천을 따로 끌 수 있음(추천은 기본 on 으로 복귀)
- [ ] 임계값 캘리브레이션(유예 15분·반경 500m·신선도 10분, 상대 1.2·하한 10%) `[보류: 라이브 데이터 부재]` — 오탐/미탐 지표가 쌓여야 튜닝 근거가 생김. 실데이터 없이는 착수 애매 ([arrival](../alerts/arrival-check-alert-v1.md#L142)·[crowd](../alerts/crowd-alert-scheduler-v1.md#L143))
- [ ] iOS 백그라운드 위치(significant-location-change) `[보류: 실기기 + iOS 네이티브]` — significant-location-change 는 실기기 검증 + 네이티브 작업 필요
- [x] KTO `tAtsNm` 이름 매칭 누락 지표화 `[코드확인]` — 조용히 사라지던 관광지 조회 스킵을 사유별(region_unresolved·budget_exhausted·no_data·name_mismatch·empty_rate) 집계 → 스캔 끝에 커버리지 요약 로그(스킵 있으면 warn). `fetchConcentration` 이 사유 반환(`ConcentrationLookup`), `CoverageMetrics` 누적. **이름 매칭 로직 개선(부분일치·별칭)은 지표 보고 판단** — 오알림 방지 스킵 동작은 유지 ([crowd](../alerts/crowd-alert-scheduler-v1.md#L143))
- [x] 강수확률 UI 노출 `[코드확인]` — 날씨 카드에 일자별 최대 POP(물방울 아이콘 + %) 노출. 단기예보만 POP 가 있어 중기·폴백 일자는 숨김. 습도는 `[제외: 불필요]` ([weather-forecast](../alerts/weather-forecast-v1.md#L88))

## 취향 · 임베딩

- [ ] confidence 활용(CRAG 보정/임계 필터) ([photo-taste](../preference/preference-photo-taste-analysis-v1.md#L152))
- [ ] 미분석 사진 전용 재분석 버튼
- [ ] 검색 품질 평가 하네스(golden set) → blend weight·radius 튜닝 ([enrichment](../preference/place-embedding-enrichment-v1.md#L149))
- [ ] ANN 스케일 region 코드 pre-filter
- [ ] 전국 재적재(현재 경상북도만 검증) `[보류: 경북 검증 우선]`
- [ ] `INDOOR_TAGS` mood/environment 자동화 · `산` 정규식 개선 ([weighting](../preference/preference-embedding-weighting-v1.md#L94))

## 트립

- [ ] 관광공사 `areaBasedList2` — 전국 일정 카탈로그 ([destination](../trips/destination-tour-api-v1.md#L81))
- [ ] 관광공사 `locationBasedList2` — 대안 후보(현재 좌표 주변)
- [ ] 영업시간 화면 배지 노출(`PlannerItineraryItemDto.openingHours`) ([opening-hours](../trips/tour-api-opening-hours-v1.md#L147))
- [ ] 카카오 전용 장소 영업시간 소스(구글 Places 등) 검토
- [ ] backfill 스테일 처리(KTO가 영업시간 내린 경우)
- [ ] 히어로 카드 날씨 미리보기 ([main-page](../trips/main-page-filters-card-v1.md#L107))
- [ ] 추천 여행지 서버 캐시(현재 프론트 staleTime만)
- [ ] 시군구 인제스천 커버리지 확대(현재 경북·대구)
- [ ] 멤버 입력 초대 링크 확장 ([trip-create](../trips/trip-create-v1.md#L195))

## 친구 · 멤버

- [x] 친구 요청 알림 채널(FCM/in-app toast) `[코드확인]` — FCM(`notifyFriendRequest`) + 인박스 목록 실시간 갱신(가상 row 라 `create` 우회 → `pushInboxRefresh` 로 직접 WS 신호, 요청 생성·취소 양쪽) + 전역 인앱 토스트(`inbox_toast` WS → providers `InboxToast`, 탭 시 /inbox) 3채널 완비. 토스트·FCM 은 `friend_request` 토글 따름, 목록 갱신은 토글 무관. **앱 전역 미읽음 배지 실시간은 모든 알림 공통 별개 이슈**(구독이 inbox-view 에만 마운트) ([friends](../friends/friends-and-trip-members-v1.md#L312))
- [ ] 비회원 멤버 직접 초대(이메일)
- [ ] 조율 `recommendation` ↔ 실 일정 item highlight 연결
- [ ] `FriendMemberPicker` floating 로직 `@floating-ui/react` 추출

## 인증 · 설정

- [ ] 약관/개인정보처리방침/고객센터/라이선스 실 페이지 `[코드확인: 없음]` ([settings](../settings/settings-v1.md#L268)·[settings-profile](../settings/settings-profile-v1.md#L246))
- [ ] `APP_VERSION` package.json 자동주입 `[코드확인: '0.1.0' 하드코딩]`
- [ ] 탈퇴 사유 수집 + soft delete(`deletedAt`) + 30일 grace `[코드확인: hard delete]`
- [ ] 디바이스별 푸시 토큰 관리 UI — 백엔드 `fcm_tokens` 테이블은 완료, 목록/해제 UI만
- [ ] refresh 토큰 RN SecureStore 이전 ([email-login](../auth/email-login-and-session-v1.md#L163))
- [ ] 429 응답 한국어 메시지 + 재시도 UI
- [ ] 이메일 인증/재설정 메일 템플릿 정리
- [ ] 프로필 이미지 webp 변환 + 썸네일
- [ ] RN 모바일 프로필 이미지 업로드 동선(image-picker + 브릿지)
- [ ] 미로그인 공통 가드(모든 nav 페이지)
- [ ] `Section`/`LinkRow`/`InfoRow` shared/ui 승격

## 인박스 · 푸시 인프라

- [x] inbox WebSocket invalidate(`inbox:<userId>`) `[코드확인]` — 게이트웨이가 인증 소켓을 `inbox:<userId>` room 에 자동 합류(멤버십 검증 불필요, 본인 채널), `InboxService.create` 가 `pushInboxInvalidate` 로 신호 → FE `useInboxInvalidateSubscription` 이 `inbox.list` invalidate. 브라우저 단독 FCM 공백 보완 ([inbox](../notification/inbox-and-trip-invite-v1.md#L450))
- [x] `trip_reminder`(D-1/D-day) 스케줄러 `[코드확인]` — `NotificationSchedulerModule`(BullMQ repeatable, weather-alert 등록 패턴 복제)이 출발 전날/당일 아침(09:00 KST) 확정 여행 멤버에 `trip_reminder` inbox+FCM 발송. Redis SET NX 로 (여행·종류)당 1회. inbox 액션 매핑이 이미 `trip_reminder→open-trip` 이라 inbox 무변경
- [x] invitee 일정 변경 owner 승인 흐름 `[코드확인]` — 원안("owner 전용 UI 숨김") 대신 **변경 UI 는 owner·참여자 모두 노출 + 비-owner 변경은 owner 승인(알림 동반) 후 반영** 으로 방향 전환. 일정 변경 6종(추가·삭제·수정·순서·swap·AI 재계획)을 범용 제안(`ScheduleChangeProposal`, kind+payload)으로 저장 → owner 가 diff 확인·승인 시 owner 권한으로 replay. 알림은 `trip_invite` 수락/거절 패턴 복제(`schedule_change_request`/`result`). 멤버 추가/제외 UI 는 (제안 대상이 아니라) owner 전용으로 숨겨 원안의 "추가/제외" 도 완결 ([invitee-change-approval](../planner/invitee-change-approval-v1.md))
- [x] owner가 pending 멤버 취소 시 invitee 알림(현재 무음) `[코드확인]` — `TripMembersService.remove`(두 삭제 경로 공통)가 pending invitee 취소 시 `InboxService.cancelTripInvite` 호출 → 남은 trip_invite 카드 삭제(jsonb tripMemberId 매칭) + general "초대 취소" 알림. 접근 불가라 open-trip 액션 없음
- [x] `friendUserId` 없는 핸들 친구 가입 유도 푸시 `[제외: 미가입자 푸시 채널 부재]` — 핸들만 등록된(friendUserId 없는) 친구는 아직 서비스 미가입이라 FCM 토큰이 없어 보낼 대상 자체가 없음. SMS·카카오 알림톡 등 외부 채널이 필요해 현재 푸시 인프라 범위 밖. 현재는 즉시 accepted 합류 유지
- [x] 알림 카테고리별 sub-filter `[코드확인]` — 기존 상태 필터(전체/읽지않음/응답필요)와 직교하는 카테고리 chip 열 추가. 현재 목록에 실제 존재하는 카테고리만 chip 노출(빈 카테고리 숨김), 선택 카테고리가 사라지면 전체로 폴백
- [x] 알림 30일 자동 archive 정책 `[코드확인]` — `NotificationArchiveService`(04:00 KST 스캔)가 읽은 지 30일 지난 알림 hard delete. 미읽음은 나이 무관 보존(못 본 알림 유실 방지), 친구 요청은 friends 가상 row 라 무영향. `synchronize` 의존이라 soft flag 컬럼 대신 삭제 선택

## 모바일 셸

- [ ] iOS/Android 번들 ID·applicationId 실도메인 확정 `[대기: 서비스 도메인 확정]` ([mobile](../setup/mobile-webview-setup.md#L226))
- [ ] release keystore 분리(현재 debug fallback) `[대기: 라이브 배포]`
- [ ] WebView 첫 로드 실패 시 retry UI
- [ ] 카메라/사진 권한(사진 업로드)

## 테스트 · 운영

- [ ] realtime 게이트웨이 인증/인가 e2e
- [ ] preferences 서비스 CRUD 커버리지
- [ ] main-planner swap/reorder/alternatives 커버리지

---

## 경계선 — 진행 여부 판단 필요

- [ ] 친구 등록 시 카카오 친구 API 연동 — §6은 카카오 **OAuth만** 문서화. 친구 목록 API는 스코프 확장 성격
- [ ] App Check 활성화(Play Integrity / DeviceCheck) `[보류: 운영 하드닝, 로드맵 밖]` — 제품 기획보다 운영 보안 하드닝
- [ ] hot-link 방지 / Object lock — 동상

## 내재적 한계 (액션 아님, 문서화만)

- iOS 앱 완전종료 시 위치 끊김 · force-stop/OS 강제종료 시 보고 불가
- 도보 직선거리 추정(강·산·고가 우회 모름, 1.3배 평균 계수)
- 중기예보 `regId` 도 단위 해상도(대표도시 nearest-centroid)
- 강수확률 폴백 경로(PTY·POP 항상 동반이라 사실상 도달 불가)
