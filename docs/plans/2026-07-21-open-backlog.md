# TriPick 미처리 백로그 트래킹

문서 목적: 각 기능 문서(`*-v1`)의 후속/백로그 섹션을 모아, 아직 안 된 항목만 체크박스로 추적한다. CLAUDE.md 기획 범위와 대조해 계획 밖 항목은 제외했다.

작성일: 2026-07-21
기준선: 최신 문서 `day-scoped-replan-v1`·`deployment-railway-vercel-runpod`(2026-07-27)까지. `[코드확인]` = 미처리 여부를 코드로 대조한 항목.
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

- [x] **"수락 → 재계획" 배선** `[코드확인]` — 알림 카테고리→트리거 매핑을 공유 상수([`REPLAN_TRIGGER_BY_CATEGORY`](../../packages/types/src/inbox.ts))로 올려 인박스 액션·푸시 탭 라우팅 양쪽이 같은 화면(`/planner?tripId=&day=&replan=<trigger>`)에 도착 → planner 비침습 배너 → 트리거 프리필 `ReplanModal`. **자동 재계획은 의도적 제외** — 배너를 닫으면 아무 잡도 안 돈다(CLAUDE.md "추천만" 원칙 유지). `ReplanTrigger` 에 `crowd` 신설(분기는 `Record<ReplanTrigger,…>` 전수 테이블), 재계획 **결과** 알림은 트리거 무관 `replan_ready` 고정해 권유 루프 차단 ([alert-replan-wiring](../alerts/alert-replan-wiring-v1.md)). 배너는 "이 날" 을 말하는데 재계획은 여행 전체이던 어긋남은 [day-scoped-replan](../planner/day-scoped-replan-v1.md)(`targetDays`, 알림 딥링크 일차가 모달 기본 범위)으로 해소. 잔여 항목은 §알림·날씨·혼잡으로 분리
- [ ] **iOS 푸시(APNs) 실기기 검증** `[대기: 실기기 + APNs Auth Key]` — iPhone 17 Pro 시뮬레이터 Debug 빌드·설치·실행과 Firebase plist 번들 포함은 확인(2026-07-22). Auth Key 업로드 + Xcode capability 및 APNs 수신은 실기기에서 검증 ([inbox](../notification/inbox-and-trip-invite-v1.md#L450)·[photo-taste](../preference/preference-photo-taste-analysis-v1.md#L152)·[trip-progress](../trips/trip-progress-live-v1.md#L147)·[mobile](../setup/mobile-webview-setup.md#L226))
- [x] **Web Push (Service Worker + VAPID)** — 브라우저 단독 사용자 푸시 수신 ([web-push](../notification/web-push-service-worker-v1.md)). 자동 권한 프롬프트→옵트인 UI, `platform='web'` 정밀 태깅은 후속
- [x] **DB 마이그레이션 인프라** `[코드확인]` — TypeORM 마이그레이션으로 전환(첫 배포 전이라 프로덕션 데이터가 없어 전환 비용이 가장 싼 시점). [app.module.ts](../../apps/api/src/app.module.ts#L62) 가 `synchronize: isDevelopment` / `migrationsRun: !isDevelopment` 로 개발·프로덕션을 **배타** 분기(둘 다 켜면 synchronize 가 마이그레이션 결과를 덮어씀) → 컨테이너가 뜨면서 스스로 스키마를 맞춰 별도 배포 단계가 없다(replica 1개 전제). 마이그레이션 2건 — 손으로 쓴 `1700000000000-InitVectorSchema`(확장·pgvector 테이블, 타임스탬프를 낮게 고정해 항상 먼저) + 자동 생성 `1785135565704-InitEntities`(엔티티 13개 DDL). CLI 용 [data-source.ts](../../apps/api/src/database/data-source.ts) + `migration:{generate,run,revert,show}` 스크립트. 빈 DB 를 `NODE_ENV=production` 으로 기동해 테이블 17개·확장 2개·HNSW 인덱스 2개 생성 확인 ([deployment §5-2](../ops/deployment-railway-vercel-runpod.md)). 로컬 개발은 `synchronize` 경로 유지 — 기존 DB 에 `migration:run` 하면 `CREATE TABLE` 충돌이라 `docker compose down -v` 후 재생성 ([preferences-enh](../preference/preferences-enhancements-v1.md#L111)·[weighting](../preference/preference-embedding-weighting-v1.md#L94))
- [x] **모달 공통 셸(`ModalShell`) 추출 + 포커스 트랩** `[코드확인]` — [modal-shell.tsx](../../apps/web/src/shared/ui/modal-shell.tsx) 가 body 스크롤 락·ESC·백드롭·포커스 트랩을 전담하고 확인 다이얼로그 6종이 패널 클래스만 넘긴다. 트랩은 [use-focus-trap.ts](../../apps/web/src/shared/lib/use-focus-trap.ts) 로 분리해 자체 애니메이션 phase 를 가진 [BottomSheet](../../apps/web/src/shared/ui/bottom-sheet.tsx) 도 훅만 재사용. `onDismiss` 를 `undefined` 로 넘기면 처리 중 닫힘을 막는다
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
- [ ] 일차 간 동선 연속성 미고려 — 2일차만 다시 짜면 1일차 마지막 장소와 2일차 첫 장소의 거리를 아무도 안 본다. 원래도 그랬으나 부분 재계획은 "나머지는 그대로" 라는 약속이라 간극이 더 눈에 띈다 ([day-scoped-replan](../planner/day-scoped-replan-v1.md#L136))
- [ ] 비연속 일차 범위(`[1,3]`)가 연속 2일로 취급됨 — AI 플래너에는 1..N 로만 넘어가고 프롬프트 기간도 1일차~3일차로 넓게 나가, 날짜별 날씨·영업요일이 어긋날 수 있다
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
- [ ] 미도착 배너가 현재 위치를 안 실어 보냄 — 문구는 "지금 위치에 맞춰" 인데 `currentLocation`·`deviatedItemId` 가 빈 채로 나가 CRAG 거리 점수가 중립값으로 떨어지고 검색도 반경 앵커 없이 목적지 전역을 훑는다. 인박스 액션에 `itemId` 를 실어 배너까지 스레딩하면 해결 ([alert-replan-wiring](../alerts/alert-replan-wiring-v1.md#L128))
- [ ] replan jobId 중복 제거가 트리거별로 갈림 — 키가 `${tripId}-${trigger}-${bucket}` 이라 배너(`weather`)와 FAB(`manual`) 로 연달아 제출하면 두 잡이 다 큐에 들어가 재생성이 두 번 돈다
- [ ] 재계획 트리거 검색 키워드에 `맛집` 계열 부재 `[보류: 후보 풀이 실제로 바뀌는 동작 변경]` — weather·deviation·crowd 셋 다. 후보 풀에 restaurant 가 얇아 식사 슬롯이 빌 수 있다. `TRIGGER_KEYWORDS` 에 NOTE 로만 남겨둠
- [x] KTO `tAtsNm` 이름 매칭 누락 지표화 `[코드확인]` — 조용히 사라지던 관광지 조회 스킵을 사유별(region_unresolved·budget_exhausted·no_data·name_mismatch·empty_rate) 집계 → 스캔 끝에 커버리지 요약 로그(스킵 있으면 warn). `fetchConcentration` 이 사유 반환(`ConcentrationLookup`), `CoverageMetrics` 누적. **이름 매칭 로직 개선(부분일치·별칭)은 지표 보고 판단** — 오알림 방지 스킵 동작은 유지 ([crowd](../alerts/crowd-alert-scheduler-v1.md#L143))
- [x] 강수확률 UI 노출 `[코드확인]` — 날씨 카드에 일자별 최대 POP(물방울 아이콘 + %) 노출. 단기예보만 POP 가 있어 중기·폴백 일자는 숨김. 습도는 `[제외: 불필요]` ([weather-forecast](../alerts/weather-forecast-v1.md#L88))

## 취향 · 임베딩

- [x] confidence 활용(CRAG 보정/임계 필터) `[코드확인]` — confidence 0.35 미만 태그는 검색·CRAG 매칭에서 제외하고, 유효 태그 점수는 confidence 만큼 중립값에서 보정 ([photo-taste](../preference/preference-photo-taste-analysis-v1.md#L152))
- [ ] 미분석 사진 전용 재분석 버튼
- [x] 검색 품질 평가 하네스(golden set) → blend weight·radius 튜닝 — `pnpm eval:retrieval` 이 실제 파이프라인(pgvector+카카오 폴백+네이버 인지도)을 그대로 태워 골든셋 10케이스에 recall@k·MRR·지역정합을 잰다. **설계 핵심은 `cat`(적재 커버리지)을 따로 재는 것** — 안 그러면 적재가 얕은 지역의 낮은 recall 을 랭킹 탓으로 오독한다. `--sweep=KEY=v1,v2` 로 환경변수 조합 반복 측정. **결론: blend weight 는 0.6 유지** — 0~1 전 구간에서 R\|cat 0.27~0.30 으로 케이스 1~2건 차이 안에서만 흔들려 바꿀 근거가 없다. 정답의 절반이 카탈로그에 없는 상태(커버리지 47%)에서 상수를 만지면 노이즈를 쫓는 셈이라 커버리지가 먼저다. radius 는 10케이스 중 카카오 폴백이 1건뿐이라 신호 자체가 안 나옴 ([region-filter-and-eval](../preference/place-retrieval-region-filter-and-eval-v1.md))
- [x] ANN 스케일 region 코드 pre-filter — `destination_region ILIKE '경상북%' OR name/address ILIKE …` 를 정본 코드 등가 비교(`region_code`·`sigungu_code` + btree)로 교체. ILIKE 는 인덱스를 못 타 전체 스캔이거나 HNSW post-filter 로 밀려나고, 후자는 지역이 선택적일수록 근사 이웃이 통째로 걸러져 **결과가 조용히 비는** 방향으로 망가진다. 9.7천 행에서 계획이 Seq Scan(17.7ms) → BitmapOr(3.2ms)로 바뀌었고, 이제 스캔이 카탈로그 전체가 아니라 그 지역 크기에만 비례한다. 코드는 적재·질의가 [region-code.ts](../../apps/api/src/planner/retrieval/region-code.ts) 같은 함수로 계산하고 **주소가 라벨보다 우선** — KTO 시도 목록이 `전남광주통합특별시` 같은 통합 행정명을 주는데 그걸 따르면 광주 장소가 전남으로 묶여 '광주' 검색에서 사라진다. 지역정합 99%·금지어 0 으로 누수 없음 확인
- [x] 전국 재적재(현재 경상북도만 검증) — 16개 시도 **9,761행**. 1차 `--reseed --max=50`(provenance 없는 옛 벡터 1,906건 폐기 → 현재 모델로 재생성 + 영업시간), 2차 `KTO_FETCH_OPENING_HOURS=false --max=300`(커버리지 확장, 신규 8,095). **영업시간은 장소당 1콜이라 커버리지 패스와 갈랐다** — 안 그러면 일일 예산 900을 300건에 다 쓴다. 남은 구멍은 §후속의 대표 명소·광주 두 건
- [ ] 대표 명소가 카탈로그에 없음 — 남산서울타워·설악산·성산일출봉이 전국 9.7천 건에 부재(골든셋 커버리지 47%). KTO `areaBasedList2` 는 인기순 정렬이 없어 페이지를 깊게 파도 안 잡힌다. 지역별 대표 명소 키워드 시드를 카카오 키워드 검색으로 적재하는 별도 패스 필요
- [ ] 광주 적재 3건 — KTO 시도 목록이 광주·전남을 `전남광주통합특별시` 로 합쳐 줘 카카오 앵커가 전남 좌표로 쏠린다. 통합 라벨 감지 → 앵커 분산 필요
- [ ] 카탈로그에 있는데 상위에 못 오는 랭킹 문제(`R|cat` 0.27) — 예: '대구 서문시장' 이 적재돼 있는데 상위 16 밖. 커버리지 개선 후 재측정하고 손대는 순서
- [ ] `INDOOR_TAGS` mood/environment 자동화 · `산` 정규식 개선 ([weighting](../preference/preference-embedding-weighting-v1.md#L94))

## 트립

- [x] 관광공사 `areaBasedList2` — 전국 일정 카탈로그 `[코드확인]` — 이미 적재 파이프라인에 연결(`TourApiService.fetchByArea`→`areaBasedList2`→pgvector 적재, [tour-api.service.ts](../../apps/api/src/planner/retrieval/tour-api.service.ts#L479)). 리트리벌은 pgvector 우선·seed 폴백. "연동"은 done, 남은 건 적재 커버리지(아래 §시군구 인제스천) ([destination](../trips/destination-tour-api-v1.md#L81))
- [x] 관광공사 `locationBasedList2` — 대안 후보(현재 좌표 주변) `[제외: 카카오+pgvector 로 대체]` `[코드확인]` — "현재 좌표 주변 대안 후보"는 이미 구현됨. `ReplanRequestDto.currentLocation` → `RetrievalContext` → [kakao-local.service.ts](../../apps/api/src/planner/retrieval/kakao-local.service.ts#L75) `search` 가 좌표를 center+radius 로 카카오 주변 검색, [crag-evaluator.service.ts](../../apps/api/src/planner/retrieval/crag-evaluator.service.ts#L141) 가 거리 점수 가점. KTO `locationBasedList2` 는 불필요(CLAUDE.md "대안 후보는 pgvector 취향 유사도로 대체" 방침 일치)
- [x] 영업시간 화면 배지 노출(`PlannerItineraryItemDto.openingHours`) `[코드확인]` — API 응답에 영업시간을 연결하고 일정 카드에 시계 아이콘과 함께 노출 ([opening-hours](../trips/tour-api-opening-hours-v1.md#L147))
- [x] 카카오 전용 장소 영업시간 소스(구글 Places 등) 검토 `[제외: 비용]` — 구글 Places 는 호출 비용이 붙어 도입 안 함. KTO 미등록 카카오 전용 장소(카페·프랜차이즈) 영업시간은 빈 채로 유지(문서 §7 한계 그대로)
- [ ] backfill 스테일 처리(KTO가 영업시간 내린 경우) `[보류: 빈도 낮음·실익 미미]` — 현재 "마지막 확보값 유지". KTO 가 영업시간 필드를 내리는 빈도가 낮아 후순위
- [x] 히어로 카드 날씨 미리보기 `[제외: 불필요]` — 요약 API 마다 격자 변환+예보 조회가 붙어 응답이 무거워지는 데 비해 목록 화면 날씨 미리보기 가치가 낮음 ([main-page](../trips/main-page-filters-card-v1.md#L107))
- [ ] 추천 여행지 서버 캐시(현재 프론트 staleTime만) `[보류: 부하 미발생]` — `DestinationsService.recommend` 는 사용자별 pgvector 집계라 캐시 이득이 있으나, 트래픽 부하가 실제로 생기기 전엔 프론트 staleTime 으로 충분
- [x] 시군구 인제스천 커버리지 확대(현재 경북·대구) — 코드가 아니라 적재 스크립트를 지역별로 돌리는 운영 작업이라 필요 시점에 인제스천 실행으로 커버. 코드 과제 아님
- [ ] 멤버 입력 초대 링크 확장 `[보류: 우선순위·규모]` — 초대 토큰 발급 + 외부 채널이라 규모가 크고, 친구 §"비회원 멤버 직접 초대(이메일)"와 겹침 ([trip-create](../trips/trip-create-v1.md#L195))

## 친구 · 멤버

- [x] 친구 요청 알림 채널(FCM/in-app toast) `[코드확인]` — FCM(`notifyFriendRequest`) + 인박스 목록 실시간 갱신(가상 row 라 `create` 우회 → `pushInboxRefresh` 로 직접 WS 신호, 요청 생성·취소 양쪽) + 전역 인앱 토스트(`inbox_toast` WS → providers `InboxToast`, 탭 시 /inbox) 3채널 완비. 토스트·FCM 은 `friend_request` 토글 따름, 목록 갱신은 토글 무관. 앱 전역 미읽음 배지 실시간은 모든 알림 공통 사안이라 별도로 완료(아래 §인박스·푸시 인프라) ([friends](../friends/friends-and-trip-members-v1.md#L312))
- [ ] 비회원 멤버 직접 초대(이메일) `[보류: 우선순위·규모]` — 초대 토큰 발급 + 메일 발송 + 가입/합류 배선이라 규모가 크고, 미가입자는 FCM 대상이 아니라 외부 채널(이메일)이 별도로 필요. 현재는 핸들 등록(즉시 accepted 합류)으로 갈음
- [x] 조율 `recommendation` ↔ 실 일정 item highlight 연결 `[제외: 기획 범위 밖]` — 조율 추천은 취향 태그 기반 설명 텍스트(`buildRecommendation`)로 충분하고, 이를 실 itinerary item 과 하이라이트로 잇는 건 기획상 불필요. 추천이 item id 를 담지 않는 현 구조 유지
- [ ] `FriendMemberPicker` floating 로직 `@floating-ui/react` 추출 `[보류: 현 구현 동작, payoff 는 shared primitive 통합 시에만]` — 유일 실사용처(friend-member-picker)는 이미 flip·maxHeight 동작해 one-off 교체 이득 미미. 진짜 가치는 shared/ui 에 `Popover` primitive 를 @floating-ui 로 만들어 [place-search-picker](../../apps/web/src/shared/ui/place-search-picker.tsx)·[destination-search-input](../../apps/web/src/features/destination-search/ui/destination-search-input.tsx) 까지 3곳 통합(flip·shift·portal 정합성 + dedup)할 때 생김. 별도 리팩터 과제라 우선순위 낮음

## 인증 · 설정

- [x] 약관/개인정보처리방침/고객센터 실 페이지 `[라이선스는 제외]` — 설정의 앵커 placeholder(`#terms`·`#privacy`·`#contact`)를 실 라우트로 대체. 공통 셸 [document-page.tsx](../../apps/web/src/shared/ui/document-page.tsx)(`DocumentPageShell` = 뒤로가기 헤더 + 섹션 카드, trip-create 헤더와 동형)를 만들고 [/legal/terms](../../apps/web/src/views/legal-terms/ui/legal-terms-view.tsx)(이용약관 11개 조항, AI 추천 면책·콘텐츠 권리 반영)·[/legal/privacy](../../apps/web/src/views/legal-privacy/ui/legal-privacy-view.tsx)(개인정보처리방침, 실 외부 연동처 카카오·ODsay·기상청·관광공사·네이버·FCM·Sentry 명시)·[/support](../../apps/web/src/views/support/ui/support-view.tsx)(고객센터 = 문의 메일 + FAQ 4개)를 정적 콘텐츠로 채움. **라이선스(`#open-source`)는 이번 범위 제외**로 앵커 유지 — 빌드 시 의존성 라이선스 자동 생성(license-checker)이 별도 과제. **남은 건 코드가 아니라 운영** — 문의/개인정보 메일은 도메인 확정 전 임시값(`support@`·`privacy@tripick.place`) + `TODO` 주석이라 §이메일 발신 도메인 확정과 함께 교체, 법무 검토도 출시 전 필요(스토어 심사에 개인정보처리방침 URL 필수) ([settings-view.tsx](../../apps/web/src/views/settings/ui/settings-view.tsx#L70))
- [x] `APP_VERSION` package.json 자동주입 `[코드확인]` — 하드코딩 `'0.1.0'`(실제 package.json `0.0.1` 과 이미 어긋나 있던) 을 제거하고 [next.config.mjs](../../apps/web/next.config.mjs) 가 `apps/web/package.json` version 을 `NEXT_PUBLIC_APP_VERSION` 으로 주입(빌드 시 인라인) → [settings-view.tsx](../../apps/web/src/views/settings/ui/settings-view.tsx#L17) 가 소비. 단일 출처라 버전 올리면 화면도 따라온다. RN 셸 자체 버전은 아직 웹 버전과 별개(네이티브 버전 브리지는 후속)
- [x] 탈퇴 사유 수집 + 2단계 확인 `[soft delete·30일 grace 는 제외]` — 결제·거래 이력이 없어 데이터 보관 의무가 없고, soft delete 로 바꾸면 cascade 사슬(여행·친구·인박스·fcm) 정합성 규칙을 새로 정해야 하는 데 비해 얻는 게 없어 hard delete 유지. 대신 오조작 방지를 절차로 옮김 — `POST /users/me/withdrawal` 이 ① 익명 사유(객관식 7 + 자유입력, 건너뛰기 가능) 수집 후 ② 확인 문구 "탈퇴" 일치 검증을 통과해야 삭제한다. 사유는 userId 없는 `withdrawal_reasons` row(가입 후 경과일만 부가)로 남아 재식별 불가 ([users.service.ts](../../apps/api/src/users/users.service.ts)·[withdrawal-dialog.tsx](../../apps/web/src/features/delete-account/ui/withdrawal-dialog.tsx))
- [x] 디바이스별 푸시 토큰 관리 UI `[제외: 실서비스 관행상 불필요]` — 다중 기기 발송은 이미 동작(사용자 1:토큰 N, `listTokens` 가 전 기기 발송)하고, 죽은 토큰은 발송 실패 시 `remove`·로그아웃/탈퇴 시 `removeForUser`/`removeAllForUser` 로 자동 청소돼 사용자가 손댈 게 없음. 실서비스에서 "푸시 기기 목록 관리" 화면은 거의 없고, 있는 건 보안 목적의 세션/로그인 기기 관리(FCM 토큰 관리 아님). 필요해지면 "이 기기에서 알림 받기" 토글 1개로 갈음하고, 다중 로그인 관리가 필요하면 별도 세션/refresh 토큰 관리 기능으로 설계 ([fcm-token.service.ts](../../apps/api/src/notification/fcm-token.service.ts))
- [x] refresh 토큰 RN SecureStore 이전 `[코드확인]` — WebView localStorage 대신 네이티브 Keychain/Keystore 에 refresh 보관, access 만 웹뷰 유지. 웹=auth HTTP·네이티브=순수 SecureStore, correlation id 브리지 + 타임아웃/확정부재 구분. `pnpm install` + 네이티브 rebuild 후 실기 검증 남음 ([refresh-token-securestore](../auth/refresh-token-securestore-v1.md)·[email-login](../auth/email-login-and-session-v1.md#L163))
- [x] 429 응답 한국어 메시지 + 재시도 UI `[코드확인]` — throttler 기본 본문이 영문(`ThrottlerException: Too many requests`)이라 사용자에게 그대로 노출되던 걸 한국어로 대체([client.ts](../../apps/web/src/shared/api/client.ts)). **남은 초는 메시지에 굽지 않는다** — 카운트다운이 도는 동안 문구가 낡기 때문에, 메시지는 고정하고 `useRetryCountdown`(데드라인 역산이라 인터벌 지연·백그라운드 탭에도 안 밀림)이 초를 세서 로그인·가입·재설정 메일·비밀번호 변경 4개 폼의 제출을 막고 "N초 후 다시 시도" 라벨을 띄운다. `Retry-After` 는 CORS 기본 노출 헤더가 아니라 [main.ts](../../apps/api/src/main.ts) `exposedHeaders` 에 명시해야 크로스 오리진에서 읽힌다 — 빠지면 카운트다운이 조용히 죽음
- [ ] 이메일 인증/재설정 메일 템플릿 정리 `[대기: 발신 도메인 확정]` `[코드확인]` — 템플릿 자체는 이미 완성. [email.service.ts](../../apps/api/src/email/email.service.ts) `buildEmailHtml` 이 브랜드 마크·CTA 버튼·"버튼 안 되면 링크 복사" 폴백·`escapeHtml`·plain text 동시 발송까지 갖춤(문서 작성 시점의 텍스트-only 상태에 백로그가 머물러 있던 것). 브랜드 표기 불일치(from `TriPick` vs 본문 마크 `Tripick`)만 이번에 통일. **남은 건 코드가 아니라 운영** — 발신 도메인 `noreply@tripick.place` 확정 + SPF/DKIM 설정(안 하면 스팸함 리스크). 도메인 확정 시 §모바일 셸 번들 ID 확정과 함께 처리
- [x] 이미지 업로드 클라 다운스케일(webp) `[코드확인]` — 원 항목("프로필 이미지 webp 변환 + 썸네일")을 프로필 단독이 아니라 취향 사진과 묶어 처리. 지난 리뷰의 "256px 하나로 프로필·취향 양쪽 재사용" 은 취향엔 틀렸다 — vision 분석이 해상도를 쓰므로 표시 크기(80px)로 줄이면 태그 추출 품질이 깎인다. 그래서 소비처별로 나눠 [downscale-image.ts](../../apps/web/src/shared/lib/downscale-image.ts) 공통 유틸이 **프로필 256px webp(표시 전용) / 취향 1024px jpeg(vision-safe)** 로 브라우저 canvas 다운스케일한다. **취향은 반드시 jpeg** — 로컬 vision 서버(llama.cpp mtmd=stb_image)가 webp 를 못 읽어 `mtmd_helper_bitmap_init_from_buf` 가 실패하고 ffprobe 폴백까지 떨어진다([profile-image-uploader](../../apps/web/src/features/manage-profile-image/ui/profile-image-uploader.tsx) 업로드 전, [preference-setup-form](../../apps/web/src/features/preference-setup/ui/preference-setup-form.tsx) 분석 잡 전). 서버는 원본 buffer 그대로 저장([users.service.ts:290](../../apps/api/src/users/users.service.ts#L290)) 무변경 — vision 잡이 스토리지에서 다시 읽어 base64 로 밀던 입력([analysis.service:120](../../apps/api/src/preference-analyzer/preference-analysis.service.ts#L120))도 같이 경량화된다. **서버 sharp·별도 썸네일 키는 제외** — 네이티브 바이너리 배포 비용 대비 얻는 게 클라 canvas 와 거의 같고, 아바타 소비처는 하나뿐이라 썸네일이 과하다. 캔버스 미지원·디코드/인코드 실패·결과가 원본보다 크면 원본 폴백(서버가 jpeg/png/webp 다 받음), EXIF 회전은 `imageOrientation` 보정
- [x] 미로그인 공통 가드(모든 nav 페이지) `[코드확인]` — 이미 구현돼 있던 항목. [session-guard.tsx](../../apps/web/src/entities/session/ui/session-guard.tsx) 의 `SessionGuard` 가 nav 5페이지(홈·취향·친구·알림·설정) + planner·trip-create·trip-progress 를, `GuestGuard` 가 login·signup·forgot-password 를 감싼다. [use-session-guard.ts](../../apps/web/src/entities/session/lib/use-session-guard.ts) `redirectWithFallback`(100ms 뒤 URL 미변경이면 하드 네비게이션)이 settings-profile 백로그의 "데스크탑 PC 미로그인 동선 — RN WebView 에서 `router.replace` silently fail" 도 같이 해소. **/reset-password 는 의도적으로 가드 없음** — 로그인 상태로 메일 링크를 눌러도 유효한 일회성 토큰과 명시적 의도를 살려야 해서 `GuestGuard` 를 붙이지 않고, 대신 재설정 성공 시 `clearSession()` 으로 서버가 이미 폐기한(`revokeAllRefreshTokens`) 죽은 로컬 세션을 비운다
- [ ] `Section`/`LinkRow`/`InfoRow` shared/ui 승격 `[보류: 유일 사용처]` `[코드확인]` — 원 문서의 승격 조건이 "다른 페이지에서도 쓰이면"인데 실사용처는 [settings-view.tsx](../../apps/web/src/views/settings/ui/settings-view.tsx) 하나뿐(friends-view·trip-info-panel 의 비슷한 이름은 `SectionLabel` 로 다른 컴포넌트). 순서 문제도 있다 — `LinkRow` 가 가리키는 `#terms`·`#privacy`·`#contact` 가 전부 스텁이라, 위 "약관/개인정보처리방침 실 페이지" 항목이 처리되면 시그니처(내부/외부 링크 구분)가 바뀐다. 지금 승격하면 shared 계약을 두 번 고치는 셈. §친구·멤버의 `FriendMemberPicker` floating 항목과 같은 판단

## 인박스 · 푸시 인프라

- [x] inbox WebSocket invalidate(`inbox:<userId>`) `[코드확인]` — 게이트웨이가 인증 소켓을 `inbox:<userId>` room 에 자동 합류(멤버십 검증 불필요, 본인 채널), `InboxService.create` 가 `pushInboxInvalidate` 로 신호 → FE `useInboxInvalidateSubscription` 이 `inbox.list` invalidate. 브라우저 단독 FCM 공백 보완 ([inbox](../notification/inbox-and-trip-invite-v1.md#L450))
- [x] `trip_reminder`(D-1/D-day) 스케줄러 `[코드확인]` — `NotificationSchedulerModule`(BullMQ repeatable, weather-alert 등록 패턴 복제)이 출발 전날/당일 아침(09:00 KST) 확정 여행 멤버에 `trip_reminder` inbox+FCM 발송. Redis SET NX 로 (여행·종류)당 1회. inbox 액션 매핑이 이미 `trip_reminder→open-trip` 이라 inbox 무변경
- [x] invitee 일정 변경 owner 승인 흐름 `[코드확인]` — 원안("owner 전용 UI 숨김") 대신 **변경 UI 는 owner·참여자 모두 노출 + 비-owner 변경은 owner 승인(알림 동반) 후 반영** 으로 방향 전환. 일정 변경 6종(추가·삭제·수정·순서·swap·AI 재계획)을 범용 제안(`ScheduleChangeProposal`, kind+payload)으로 저장 → owner 가 diff 확인·승인 시 owner 권한으로 replay. 알림은 `trip_invite` 수락/거절 패턴 복제(`schedule_change_request`/`result`). 멤버 추가/제외 UI 는 (제안 대상이 아니라) owner 전용으로 숨겨 원안의 "추가/제외" 도 완결 ([invitee-change-approval](../planner/invitee-change-approval-v1.md))
- [x] owner가 pending 멤버 취소 시 invitee 알림(현재 무음) `[코드확인]` — `TripMembersService.remove`(두 삭제 경로 공통)가 pending invitee 취소 시 `InboxService.cancelTripInvite` 호출 → 남은 trip_invite 카드 삭제(jsonb tripMemberId 매칭) + general "초대 취소" 알림. 접근 불가라 open-trip 액션 없음
- [x] `friendUserId` 없는 핸들 친구 가입 유도 푸시 `[제외: 미가입자 푸시 채널 부재]` — 핸들만 등록된(friendUserId 없는) 친구는 아직 서비스 미가입이라 FCM 토큰이 없어 보낼 대상 자체가 없음. SMS·카카오 알림톡 등 외부 채널이 필요해 현재 푸시 인프라 범위 밖. 현재는 즉시 accepted 합류 유지
- [x] 알림 카테고리별 sub-filter `[코드확인]` — 기존 상태 필터(전체/읽지않음/응답필요)와 직교하는 카테고리 chip 열 추가. 현재 목록에 실제 존재하는 카테고리만 chip 노출(빈 카테고리 숨김), 선택 카테고리가 사라지면 전체로 폴백
- [x] 알림 30일 자동 archive 정책 `[코드확인]` — `NotificationArchiveService`(04:00 KST 스캔)가 읽은 지 30일 지난 알림 hard delete. 미읽음은 나이 무관 보존(못 본 알림 유실 방지), 친구 요청은 friends 가상 row 라 무영향. `synchronize` 의존이라 soft flag 컬럼 대신 삭제 선택
- [x] nav 미읽음 배지 앱 전역 실시간 `[코드확인]` — 기존 `inbox_invalidate` 구독이 inbox-view 에만 마운트돼 다른 페이지 배지가 안 갱신되던 공백 해소. `subscribe-inbox-unread`(세션 게이팅 인박스 요약 조회 + 전역 `inbox_invalidate` 구독)가 미읽음 수를 추적해 providers 에서 앱 트리에 주입, 하단 탭·데스크탑 nav 알림 아이템에 배지 노출(하단 9+·데스크탑 99+ 축약). shared(nav)는 `InboxBadgeProvider` context 계약만 두고 값은 상위 feature 가 채워 순수 유지(FSD). 쿼리 키가 inbox-view 와 같아 캐시 공유(중복 fetch 없음)

## 모바일 셸

- [ ] iOS/Android 번들 ID·applicationId 실도메인 확정 `[대기: 서비스 도메인 확정]` ([mobile](../setup/mobile-webview-setup.md#L226))
- [ ] release keystore 분리(현재 debug fallback) `[대기: 라이브 배포]`
- [x] WebView 첫 로드 실패 시 retry UI `[코드확인]` — 첫 네트워크/HTTP 오류에 안내와 재시도 버튼을 표시하고 WebView remount 로 복구
- [ ] 웹뷰 파일 선택 사진 업로드 — 실기 확인만 남음 `[대기: 실기기]` — 프로필 이미지·취향 사진이 같은 `<input type=file>` 경로(둘 다 `accept="image/jpeg,image/png,image/webp"`, 취향은 `multiple`)라 하나로 묶음. 취향 사진이 막히면 온보딩 핵심 플로우가 앱에서 끊긴다. **원안(image-picker + 브리지 + data: URL 전송)은 폐기** — 웹 업로드 UI 를 네이티브에 이중 구현하는 비용인데 react-native-webview 가 Android `onShowFileChooser`·iOS WKWebView 파일 입력을 이미 처리한다. 네이티브 설정만 채웠고([manifest](../../apps/mobile/android/app/src/main/AndroidManifest.xml)·[Info.plist](../../apps/mobile/ios/TriPick/Info.plist)) 브리지 코드는 넣지 않았다. **Android 는 권한 선언이 오히려 해가 된다** — 갤러리 선택은 SAF(`ACTION_GET_CONTENT`)라 `READ_MEDIA_IMAGES` 없이 동작하고, `CAMERA` 를 선언하면 `RNCWebViewModuleImpl.needsCameraPermission()` 이 "선언됐는데 미승인" 을 감지해 촬영 항목을 시트에서 빼버린다(미선언 시 시스템 카메라 앱 위임으로 그냥 됨). 대신 Android 11+ 패키지 가시성 때문에 `IMAGE_CAPTURE` `<queries>` 만 추가. iOS 는 사용 설명 문구가 없으면 접근 순간 크래시라 `NSCameraUsageDescription`·`NSPhotoLibraryUsageDescription` 추가. 실기 확인 항목 — ① 갤러리 선택 ② 촬영 항목 노출·촬영 ③ 취향 사진 다중 선택 ④ webp accept 동작. 하나라도 안 되면 그때 image-picker 폴백

## 테스트 · 운영

- [x] realtime 게이트웨이 인증/인가 e2e `[코드확인]` — 실 socket.io 서버를 임의 포트로 띄우고 진짜 클라이언트로 붙어 게이트웨이 인증/인가 왕복을 검증([realtime-gateway.e2e-spec.ts](../../apps/api/test/realtime/realtime-gateway.e2e-spec.ts)). JWT 는 실제 `JwtModule` 로 서명/검증, 멤버십(`canAccessTrip`)만 목킹해 DB 없이 분기 제어. 6케이스 — 무토큰/무효토큰 즉시 절단·유효토큰 유지+인박스 room 자동합류·`join-trip` 멤버 joined/비멤버 join-denied(+room 방송 미도달)·`evictFromTrip` 회수 시 `trip-access-revoked` 통지+room 방송 절단. 기존 e2e(happy path 1케이스)가 못 덮던 부정경로·인가 회수를 채움
- [x] preferences 서비스 CRUD 커버리지 `[코드확인]` — 기존 spec 이 `upsert` 기상/취침 검증만 덮던 걸 전 메서드로 확장([preferences.service.spec.ts](../../apps/api/test/preferences/preferences.service.spec.ts), 3→12케이스). `findByUser`(조회·null), `getPreferenceVector`(위임), `setPhotoUrls`(행 없으면 기본값 생성·재임베딩 스킵/사진 삭제 시 photoTags·disabledPhotoTags 정리), `upsert`(신규 생성·배열 dedup/부분 dto 병합/취향 신호 유무에 따른 임베딩 호출·embeddingId 반영) 커버
- [x] main-planner swap/reorder/alternatives 커버리지 `[코드확인]` — 기존 main-planner 테스트가 addItem·createTrip·DTO 검증만 덮던 세 서비스 경로의 실동작 추가([main-planner.swap-reorder-alternatives.spec.ts](../../apps/api/test/main-planner/main-planner.swap-reorder-alternatives.spec.ts), 8케이스). `swap`(장소·좌표·카테고리 교체+이전 장소 보관·inbox 알림/앞뒤 이동시간 빠듯 시 경고), `reorderItems`(order 1..n 재배정+시각 오름차순 슬롯 재배정/개수·구성 불일치 400), `getAlternatives`(실후보 3+ realtime=true·폴백 미보충/무결과+note없음 mock 3개 보충/note 있으면 결과없음 노출/기 담긴 장소 dedup)

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
