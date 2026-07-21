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
- [ ] 대안 swap 시 영업시간 위반 경고
- [ ] 현재 장소 비교 카드(P3-9) → 대안 카드 취향 근거(reason) 정식 노출로 대체 — 좌우 비교 카드는 BottomSheet 세로 레이아웃에 부적합. 현재 `place.reason` 을 `waitLabel` 에 욱여넣어(28자 절단) 있어 전용 필드 분리 필요(FE+BE, `feat/alternative-card-enrichment`)
- [x] pending/resolve 후보 마커 좌표 정규화 일관화 `[코드확인]` — 추천/resolve 응답 마커를 병합 후 `normalizeMarkerPositions` 로 폴백 x·y 재정규화(SDK 미로딩 미리보기 정합)
- [ ] 필수 포함 장소 LLM 경로 보장 주입(현재 best-effort) ([planner-enh](../planner/planner-page-enhancements-v1.md#L124))
- [x] 검색 드롭다운 키보드 내비 · 태블릿 사이드바 접힘 localStorage `[코드확인]` — combobox/listbox + 방향키·Enter·Esc, 사이드바 접힘 상태 localStorage 유지

## 라우팅

- [ ] `departAt` 지원 `[코드확인: 없음]` — 심야 대중교통 ETA 오차 ([routing](../planner/routing-external-api-v1.md#L199))
- [ ] in-flight 병합 Redis 락(스케일아웃 시 인스턴스 간 중복)
- [ ] ODsay 쿼터 폴백 지표화
- [ ] `ODSAY_SERVICE_URL` 실제 등록 도메인으로 교체 `[대기: 라이브 배포]`
- (도보 직선거리 추정은 내재적 한계 — 아래 §내재적 한계 참고)

## 알림 · 날씨 · 혼잡

- [ ] 예보 악화 시 재알림(선점 키에 확률 저장) ([weather-alert](../alerts/weather-alert-scheduler-v1.md#L130))
- [ ] 일차 딥링크(푸시 payload `day` 반영)
- [ ] 날씨/재계획 알림 수신 토글 분리(현재 `replan_ready` 공유) `[보류: 기존 토글 설계 유지]`
- [ ] 임계값 캘리브레이션(유예 15분·반경 500m·신선도 10분, 상대 1.2·하한 10%) ([arrival](../alerts/arrival-check-alert-v1.md#L142)·[crowd](../alerts/crowd-alert-scheduler-v1.md#L143))
- [ ] iOS 백그라운드 위치(significant-location-change)
- [ ] KTO `tAtsNm` 이름 매칭 누락 처리
- [ ] 강수확률/습도 UI 노출 ([weather-forecast](../alerts/weather-forecast-v1.md#L88))

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

- [ ] 친구 요청 알림 채널(FCM/in-app toast) ([friends](../friends/friends-and-trip-members-v1.md#L312))
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

- [ ] inbox WebSocket invalidate(`inbox:<userId>`) `[코드확인: 없음]` ([inbox](../notification/inbox-and-trip-invite-v1.md#L450))
- [ ] `trip_reminder`(D-1/D-day) 스케줄러 — `weather_alert`는 완료, `trip_reminder`는 type만 존재
- [ ] invitee trip 뷰 owner 전용 UI 숨김(추가/제외/swap)
- [ ] owner가 pending 멤버 취소 시 invitee 알림(현재 무음)
- [ ] `friendUserId` 없는 핸들 친구 가입 유도 푸시
- [ ] 알림 카테고리별 sub-filter
- [ ] 알림 30일 자동 archive 정책

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
