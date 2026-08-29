'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IconType } from 'react-icons';
import {
  LuChevronLeft,
  LuChevronRight,
  LuChevronsLeft,
  LuChevronsRight,
  LuCloudSun,
  LuFootprints,
  LuMapPin,
  LuShare2,
  LuSparkles,
  LuUserPlus,
  LuX,
} from 'react-icons/lu';
import { useQuery } from '@tanstack/react-query';
import type {
  PlannerItineraryItemDto,
  PlannerMapMarkerDto,
  PlannerSwapResponseDto,
  PlannerTripDto,
  ReplanTrigger,
} from '@tripick/types';

import { SessionGuard } from '@/entities/session';
import {
  fetchPlannerTrip,
  fetchPlannerTrips,
  isTripPeriodActive,
  useActiveTrip,
} from '@/entities/trip-plan';
import { MemberAvatars } from '@/entities/member';
import { useApplySearchedPlace, type SearchedPlace } from '@/features/apply-searched-place';
import { DaySelector } from '@/features/day-selector';
import { DeleteTripButton } from '@/features/delete-trip';
import { EditableTimeline } from '@/features/edit-itinerary';
import {
  PendingProposalsPanel,
  ScheduleChangePreviewModal,
} from '@/features/manage-schedule-changes';
import { TripMembersSheet } from '@/features/manage-trip-members';
import { PlannerTabs, type PlannerTab } from '@/features/planner-tab-switch';
import { ReplanModal } from '@/features/request-replan';
import { ShareTripSheet } from '@/features/share-trip';
import { ReplanToast } from '@/features/subscribe-replan-result';
import { queryKeys } from '@/shared/api/query-keys';
import { useMediaQuery } from '@/shared/lib';
import { readJson, writeJson } from '@/shared/lib/storage';
import { Chip, Toast } from '@/shared/ui';
import { AppBottomNavigation, AppDesktopNavigation, useNavSlideClass } from '@/shared/ui/app-frame';

const TAB_ORDER: PlannerTab[] = ['schedule', 'map', 'info', 'coordination'];
import { AlternativeSheet } from '@/widgets/alternative-sheet';
import { PlannerHeader } from '@/widgets/planner-header';
import { PlannerMap } from '@/widgets/planner-map';
import { TripCoordinationPanel } from '@/widgets/trip-coordination-panel';
import { TripInfoPanel } from '@/widgets/trip-info-panel';
import { TripMapPanel } from '@/widgets/trip-map-panel';

/** 태블릿 좌측 패널 접힘 상태 저장 키 */
const SIDEBAR_COLLAPSED_KEY = 'tripick:planner:sidebar-collapsed';

const TRIP_STATUS_LABEL: Record<PlannerTripDto['progress']['status'], string> = {
  draft: '준비 중',
  upcoming: '일정 완성',
  ongoing: '여행 중',
  done: '여행 종료',
};

/**
 * @MX:ANCHOR: 결과 화면 "상단 요약 카드" — 목업 mockup 4 정본(상태 칩, 여행명, 기간,
 * "하루의 빛" 가로 미니 레일, 핵심 톤 그라데이션 레일, 태그, 취향 출처 문구). REQ-WVR-040.
 * @MX:REASON: fan_in — 모바일 셸 + 데스크탑 사이드바 두 진입점에서 공유하는 결과 화면의
 * 시그니처 요약 컴포넌트.
 */
function TripLightSummaryCard({
  trip,
  compact = false,
}: {
  trip: PlannerTripDto;
  compact?: boolean;
}) {
  const tags = [
    ...trip.meta.tasteTags.food,
    ...trip.meta.tasteTags.mood,
    ...trip.meta.tasteTags.environment,
  ].slice(0, 4);
  const toneText = tags.length > 0 ? tags.slice(0, 3).join(' · ') : null;

  return (
    <section
      className={`wvr-scope rounded-[20px] border border-[color:var(--line)] bg-[color:var(--card)] shadow-[var(--shadow-card)] ${
        compact ? 'p-4' : 'mb-3 p-5'
      }`}
      aria-label="여행 요약"
    >
      <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[color:var(--primary-tint)] px-2.5 py-1 text-[11.5px] font-bold text-[color:var(--primary)]">
        {TRIP_STATUS_LABEL[trip.progress.status]}
      </span>

      <h2 className="mt-2.5 text-[22px] font-extrabold leading-[1.25] tracking-[-0.03em] text-[color:var(--ink)]">
        {trip.title}
      </h2>
      <p className="mt-1 text-[13px] font-semibold text-[color:var(--ink-sub)]">
        {trip.meta.startDate} → {trip.meta.endDate} · {trip.meta.durationLabel}
      </p>

      {/* "하루의 빛" 가로 미니 레일 — 세로 타임라인과 동일 정지점(REQ-WVR-040) */}
      <div
        className="mt-4"
        role="img"
        aria-label="하루의 빛: 아침 파랑에서 저녁 코랄까지, 시간대별 색 안내"
      >
        <div
          className="relative h-[3px] rounded-full"
          style={{
            background:
              'linear-gradient(90deg, var(--t-morning) 0%, var(--t-noon) 36%, var(--t-gold) 70%, var(--t-dusk) 100%)',
          }}
        >
          {(
            [
              ['--t-morning', '2%'],
              ['--t-noon', '36%'],
              ['--t-gold', '70%'],
              ['--t-dusk', '98%'],
            ] as const
          ).map(([token, left]) => (
            <span
              key={token}
              className="absolute top-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
              style={{
                left,
                background: `var(${token})`,
                borderColor: 'var(--card)',
                boxShadow: '0 0 0 1px var(--line)',
              }}
            />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[10.5px] font-semibold text-[color:var(--ink-faint)]">
          <span>아침</span>
          <span>낮</span>
          <span>오후</span>
          <span>저녁</span>
        </div>
      </div>

      {/* 핵심 톤 그라데이션 레일 — 취향 태그 요약(신뢰도 % 등 실데이터 없는 값은 제외) */}
      {toneText ? (
        <div
          className="mt-4 border-l-[3px] pl-3"
          style={{ borderImage: 'linear-gradient(180deg, var(--t-morning), var(--t-dusk)) 1' }}
        >
          <span className="block text-[11px] font-bold tracking-[0.05em] text-[color:var(--ink-faint)]">
            핵심 톤
          </span>
          <p className="mt-0.5 text-[15px] font-semibold leading-[1.55] tracking-[-0.015em] text-[color:var(--ink)]">
            {toneText}
          </p>
        </div>
      ) : null}

      {!compact && tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-[color:var(--line)] bg-[color:var(--card-soft)] px-2.5 py-1 text-[12.5px] font-semibold text-[color:var(--ink-sub)]"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {!compact ? (
        <p className="mt-3 text-[12.5px] text-[color:var(--ink-faint)]">
          취향 태그를 반영해 만든 일정이에요
        </p>
      ) : null}
    </section>
  );
}

/**
 * 알림 딥링크로 planner 에 들어왔을 때 뜨는 비침습 재계획 배너 문구.
 * 배너는 "권유"만 한다 — 닫으면 아무 잡도 안 돌고 일정만 본다(CLAUDE.md: 추천만, 재계획은 수동).
 * 'manual' 은 배너로 노출되지 않으므로(사용자가 직접 버튼을 누른 경우) 매핑에서 제외.
 */
const REPLAN_BANNER_COPY: Record<
  Exclude<ReplanTrigger, 'manual'>,
  {
    Icon: IconType;
    title: string;
    body: string;
  }
> = {
  weather: {
    Icon: LuCloudSun,
    title: '이 날 날씨 변화가 예상돼요',
    body: '실내·대체 장소 위주로 일정을 다시 짜볼까요?',
  },
  crowd: {
    Icon: LuFootprints,
    title: '이 날 혼잡이 예상돼요',
    body: '덜 붐비는 장소로 일정을 다시 짜볼까요?',
  },
  deviation: {
    Icon: LuMapPin,
    title: '일정 장소에 도착하지 못한 것 같아요',
    body: '지금 위치에 맞춰 일정을 다시 짜볼까요?',
  },
};

export function PlannerView({
  tripId,
  initialDay,
  initialProposalId,
  initialReplanTrigger,
}: {
  tripId?: string;
  initialDay?: number;
  /** 인박스 "확인" 딥링크로 열린 경우, 검토할 제안 id (owner) */
  initialProposalId?: string;
  /** 알림(날씨·혼잡·미도착) 딥링크로 열린 경우, 재계획 배너에 프리필할 트리거 */
  initialReplanTrigger?: ReplanTrigger;
}) {
  return (
    <SessionGuard>
      <PlannerContent
        {...(tripId ? { tripId } : {})}
        {...(initialDay ? { initialDay } : {})}
        {...(initialProposalId ? { initialProposalId } : {})}
        {...(initialReplanTrigger ? { initialReplanTrigger } : {})}
      />
    </SessionGuard>
  );
}

function PlannerContent({
  tripId,
  initialDay,
  initialProposalId,
  initialReplanTrigger,
}: {
  tripId?: string;
  initialDay?: number;
  initialProposalId?: string;
  initialReplanTrigger?: ReplanTrigger;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<PlannerTab>('schedule');
  // 탭 이동 방향에 맞춘 콘텐츠 등장 클래스. 사용자가 탭을 눌렀을 때만 방향을 갱신하고
  // (딥링크 등 프로그램적 전환은 setTab 직접 호출 = 기본 페이드 유지), 상태로 들고 있어
  // 무관한 리렌더에 애니메이션 클래스가 바뀌며 재생되는 걸 막는다.
  const [tabAnim, setTabAnim] = useState('app-tab-in');
  const handleTabChange = (next: PlannerTab) => {
    const delta = TAB_ORDER.indexOf(next) - TAB_ORDER.indexOf(tab);
    if (delta !== 0) setTabAnim(delta > 0 ? 'app-slide-in-right' : 'app-slide-in-left');
    setTab(next);
  };
  const pageInClass = useNavSlideClass();
  const [day, setDay] = useState(initialDay ?? 1);
  const [openItem, setOpenItem] = useState<PlannerItineraryItemDto | null>(null);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [swapResult, setSwapResult] = useState<{ id: string; name: string } | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [replanOpen, setReplanOpen] = useState(false);
  // 재계획 모달 트리거. 일반 "AI 재계획" 버튼은 'manual', 알림 배너에서 열면 그 알림의 트리거.
  const [replanTrigger, setReplanTrigger] = useState<ReplanTrigger>('manual');
  // 알림(날씨·혼잡·미도착) 딥링크로 들어온 경우에만 뜨는 비침습 배너.
  // 닫으면 그냥 일정만 본다(자동 재계획 없음) — CLAUDE.md "추천만, 재계획은 수동" 원칙.
  const [alertBanner, setAlertBanner] = useState<ReplanTrigger | null>(
    initialReplanTrigger ?? null,
  );

  // 배너를 닫거나 재계획 모달로 넘어가면 URL 의 ?replan= 도 함께 지운다. 남겨두면 뒤로가기·
  // 새로고침으로 재진입할 때마다 이미 처리한 제안 배너가 다시 뜬다. history 만 갈아끼우므로
  // (router.replace 와 달리) 리렌더·데이터 재요청은 없다.
  const dismissAlertBanner = useCallback(() => {
    setAlertBanner(null);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('replan')) return;
    url.searchParams.delete('replan');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  function openReplan(trigger: ReplanTrigger) {
    setReplanTrigger(trigger);
    setReplanOpen(true);
  }
  // 진행 중 여행이 있으면 우하단 "여행 중" FAB(ActiveTripFab)가 떠서 겹치므로 재계획 버튼을 그 위로 쌓는다
  const { active: activeTrip } = useActiveTrip();
  const [shareOpen, setShareOpen] = useState(false);
  // owner: 검토 중인 일정 변경 제안 id (패널/인박스 딥링크에서 연다)
  const [previewProposalId, setPreviewProposalId] = useState<string | null>(
    initialProposalId ?? null,
  );
  // 데스크탑 좌측 패널 탭 (2xl 미만: 우측 정보/조율 컬럼이 없어 좌측에서 전환)
  const [sidePanel, setSidePanel] = useState<'schedule' | 'info' | 'coordination'>('schedule');
  // 태블릿(2xl 미만)에서 좌측 패널을 접어 지도 영역을 넓힐 수 있게 한다.
  // 접힘 상태는 localStorage 에 유지(SSR 하이드레이션 불일치를 피해 마운트 후 복원).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    const stored = readJson<boolean>(SIDEBAR_COLLAPSED_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 접힘 상태를 마운트 후 복원(SSR-safe)
    if (stored !== null) setSidebarCollapsed(stored);
  }, []);
  useEffect(() => {
    writeJson(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed);
  }, [sidebarCollapsed]);
  const isWideDesktop = useMediaQuery('(min-width: 1536px)');
  const activeSidePanel = isWideDesktop ? 'schedule' : sidePanel;
  const sidebarVisible = isWideDesktop || !sidebarCollapsed;
  const [placeToast, setPlaceToast] = useState<{
    tone: 'primary' | 'success' | 'warning' | 'error';
    title: string;
    message?: string;
  } | null>(null);

  const {
    data: trips = [],
    error: tripsError,
    isLoading: isTripsLoading,
  } = useQuery({
    queryKey: queryKeys.planner.trips,
    queryFn: fetchPlannerTrips,
    enabled: !tripId,
    staleTime: 5 * 60 * 1000,
  });

  const firstTripId = trips[0]?.id;
  const selectedTripId = tripId ?? firstTripId ?? '';

  useEffect(() => {
    if (!tripId && firstTripId) {
      router.replace(`/planner?tripId=${firstTripId}`);
    }
  }, [firstTripId, router, tripId]);

  const { data: trip = null, error } = useQuery<PlannerTripDto>({
    queryKey: queryKeys.planner.trip(selectedTripId || 'pending'),
    queryFn: () => fetchPlannerTrip(selectedTripId),
    enabled: Boolean(selectedTripId),
    staleTime: 5 * 60 * 1000,
  });

  // 선택한 일차가 새 여행 데이터에 없으면 첫 일차로 보정 (effect 대신 렌더 단계 조정 —
  // 보정 후 조건이 거짓이 되어 무한 루프가 없다).
  if (trip && !trip.days.some((item) => item.day === day)) {
    setDay(trip.days[0]?.day ?? 1);
  }

  const loadError =
    error instanceof Error
      ? error.message
      : tripsError instanceof Error
        ? tripsError.message
        : null;
  const isResolvingTrip = !selectedTripId && isTripsLoading;
  const isLiveActive = trip ? isTripPeriodActive(trip.meta.startDate, trip.meta.endDate) : false;

  const itemsForDay = useMemo(() => {
    if (!trip) return [];
    const base = trip.items.filter((item) => item.day === day);
    if (!swapResult) return base;
    return base.map((item) =>
      item.id === swapResult.id ? { ...item, name: swapResult.name } : item,
    );
  }, [trip, day, swapResult]);

  const dayMarkers = useMemo<PlannerMapMarkerDto[]>(() => {
    if (!trip) return [];
    const itemIds = new Set(itemsForDay.map((i) => i.id));
    return trip.mapMarkers.filter((m) => !m.itemId || itemIds.has(m.itemId));
  }, [trip, itemsForDay]);

  const focusedMarker = useMemo<PlannerMapMarkerDto | null>(() => {
    if (!focusedItemId) return null;
    return dayMarkers.find((m) => m.itemId === focusedItemId) ?? null;
  }, [focusedItemId, dayMarkers]);

  const focusedMarkerId = focusedMarker?.id ?? null;
  const mapCenter = focusedMarker
    ? { lat: focusedMarker.lat, lng: focusedMarker.lng, level: 4 }
    : (trip?.mapCenter ?? { lat: 35.8347, lng: 129.2247, level: 7 });

  const focusedItem = itemsForDay.find((i) => i.id === focusedItemId) ?? null;
  const isOwner = trip?.isOwner ?? false;
  // 비-owner 변경 제안 성공 시 안내 토스트
  const handleProposed = () =>
    setPlaceToast({
      tone: 'success',
      title: '변경 요청을 보냈어요',
      message: '여행 관리자가 승인하면 일정에 반영돼요.',
    });
  const applyPlace = useApplySearchedPlace(trip?.id ?? selectedTripId, {
    isOwner,
    onProposed: handleProposed,
  });

  // 지도 검색으로 고른 장소를 "선택한 일정 항목"에 반영(swap)한다
  function handlePickSearchPlace(place: SearchedPlace) {
    if (!focusedItem) {
      setPlaceToast({
        tone: 'warning',
        title: '먼저 일정을 선택하세요',
        message: '지도에 반영할 일정 항목을 목록에서 눌러 선택해 주세요.',
      });
      return;
    }
    const targetName = focusedItem.name;
    applyPlace.mutate(
      { itemId: focusedItem.id, place },
      {
        onSuccess: (result) => {
          // 비-owner 제안 모드: 훅이 onProposed 로 토스트를 띄우므로 여기선 반영 처리 안 함
          if (!isOwner) return;
          const swap = result as PlannerSwapResponseDto;
          setSwapResult({ id: swap.swappedItemId, name: swap.newItemName });
          setPlaceToast({
            tone: 'success',
            title: `‘${targetName}’을(를) 바꿨어요`,
            message: swap.warnings?.length
              ? `${swap.newItemName} · ${swap.warnings[0]}`
              : `${swap.newItemName}(으)로 변경했어요.`,
          });
        },
        onError: (err) => {
          setPlaceToast({
            tone: 'error',
            title: '장소를 반영하지 못했어요',
            ...(err instanceof Error ? { message: err.message } : {}),
          });
        },
      },
    );
  }

  // 토스트 자동 닫힘
  useEffect(() => {
    if (!placeToast) return;
    const timer = setTimeout(() => setPlaceToast(null), 3600);
    return () => clearTimeout(timer);
  }, [placeToast]);

  const pickPlaceLabel = focusedItem ? '이 일정으로 변경' : '이 장소로 일정 변경';

  return (
    <div className="wvr-scope min-h-dvh overflow-x-clip bg-[color:var(--bg)]">
      {/* < lg : phone shell (모바일 우선) — 대상 화면(결과) 범위: wvr-scope 로컬 팔레트 */}
      <div
        className={`wvr-scope ${pageInClass} mx-auto min-h-dvh max-w-[430px] pb-[calc(168px+var(--fab-reserve)+var(--safe-bottom))] lg:hidden`}
      >
        <PlannerHeader
          title={trip?.title ?? (isResolvingTrip ? '여행 찾는 중' : '여행을 먼저 만들어주세요')}
          members={trip?.members ?? []}
          {...(trip ? { onMembersClick: () => setMembersOpen(true) } : {})}
          {...(trip ? { onShareClick: () => setShareOpen(true) } : {})}
        />

        {isLiveActive ? <LivePromoBanner /> : null}

        {/* 요약 카드는 모바일에선 "정보" 탭 안으로 넣는다 — 좁은 화면에서 지도·일정보다
            위에 두면 첫 화면이 요약으로 차서 정작 오늘 일정이 스크롤 밖으로 밀린다.
            데스크탑은 사이드바 상단(compact)에 그대로 남는다. */}
        {/* "지도" 탭은 자기 지도(4:5 + 마커 선택)를 그리므로 상단 미리보기를 걷어낸다 —
            둘 다 두면 좁은 화면을 같은 지도 두 장이 차지한다. 검색·길찾기 오버레이는
            그 탭 지도로 옮겨 붙여 기능은 그대로다. */}
        {tab === 'map' ? null : trip ? (
          <PlannerMap
            placeholder={trip.searchPlaceholder}
            center={mapCenter}
            markers={dayMarkers}
            fitMarkers={!focusedMarker}
            onPickSearchPlace={handlePickSearchPlace}
            pickPlaceLabel={pickPlaceLabel}
          />
        ) : (
          <div className="flex aspect-[390/290] items-center justify-center bg-[color:var(--card-soft)] px-5 text-center text-[13px] font-semibold text-[color:var(--ink-faint)]">
            {isResolvingTrip ? '내 여행을 찾는 중' : '새 여행을 만들면 일정과 지도가 표시돼요'}
          </div>
        )}

        {selectedTripId ? <PlannerTabs value={tab} onChange={handleTabChange} /> : null}

        {trip && tab !== 'coordination' ? (
          <div className="px-4 pt-3">
            <DaySelector days={trip.days} value={day} onChange={setDay} />
          </div>
        ) : null}

        <div className="relative px-4 pb-8 pt-3">
          {loadError ? (
            <div
              role="alert"
              className="rounded-[16px] border border-[color:var(--danger-border)] bg-[color:var(--danger-tint)] p-4 text-[14px] text-[color:var(--danger)]"
            >
              {loadError}
            </div>
          ) : null}

          {!selectedTripId && !loadError ? <PlannerEmptyState loading={isResolvingTrip} /> : null}

          {/* key={tab} 로 탭이 바뀔 때만 리마운트해 등장 모션(이동 방향 슬라이드)을 재생한다 */}
          <div key={tab} className={tabAnim}>
            {tab === 'schedule' && trip ? (
              <>
                <PendingProposalsPanel
                  tripId={trip.id}
                  isOwner={isOwner}
                  onOpenProposal={setPreviewProposalId}
                />
                <EditableTimeline
                  tripId={trip.id}
                  day={day}
                  items={itemsForDay}
                  selectedItemId={focusedItemId}
                  onSelectItem={(item) => setFocusedItemId(item.id)}
                  onSwitchItem={setOpenItem}
                  isOwner={isOwner}
                  onProposed={handleProposed}
                />
              </>
            ) : null}
            {tab === 'map' && trip ? (
              <TripMapPanel
                trip={trip}
                items={itemsForDay}
                onSelectItem={setOpenItem}
                onPickSearchPlace={handlePickSearchPlace}
                pickPlaceLabel={pickPlaceLabel}
              />
            ) : null}
            {tab === 'info' && trip ? (
              <>
                <TripLightSummaryCard trip={trip} />
                <TripInfoPanel trip={trip} />
              </>
            ) : null}
            {tab === 'coordination' && trip ? <TripCoordinationPanel tripId={trip.id} /> : null}
          </div>

          {trip?.isOwner ? (
            <div className="mt-6 border-t border-[color:var(--card-soft)] pt-5">
              <DeleteTripButton tripId={trip.id} tripTitle={trip.title} variant="menu" />
            </div>
          ) : null}

          {trip ? (
            <button
              type="button"
              aria-label="AI 재계획"
              onClick={() => openReplan('manual')}
              className={`fixed z-20 flex size-14 items-center justify-center rounded-full text-[color:var(--btn-text)] shadow-[var(--shadow-btn)] active:translate-y-px lg:hidden ${
                activeTrip
                  ? 'bottom-[calc(152px+var(--safe-bottom))]'
                  : 'bottom-[calc(96px+var(--safe-bottom))]'
              }`}
              style={{
                right: 'max(20px, calc((100vw - 430px) / 2 + 20px))',
                background: 'var(--btn-bg)',
              }}
            >
              <LuSparkles className="size-6" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
      <AppBottomNavigation className="lg:hidden" />

      {/* ≥ lg : 데스크탑 웹 레이아웃 — 대상 화면(결과) 범위: wvr-scope 로컬 팔레트 */}
      <div className="mx-auto hidden w-full max-w-[1640px] lg:grid lg:min-h-dvh lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6 lg:px-6">
        <AppDesktopNavigation />
        {/* 본문만 등장 모션 — 사이드 네비는 애니메이션 없이 그려 셸이 고정된 것처럼 보이게 한다 */}
        <div
          className={`wvr-scope ${pageInClass} min-h-dvh overflow-hidden border-x border-[color:var(--line)] bg-[color:var(--card)]`}
        >
          <header className="border-b border-[color:var(--line)] bg-[color:var(--card)]">
            {/* lg~xl 사이(노트북 폭)에서 좌우가 서로 밀어 글자가 줄바꿈되던 헤더.
                왼쪽 묶음만 줄어들게(min-w-0 flex-1) 하고 제목은 말줄임, 액션 묶음은
                shrink-0 + 줄바꿈 금지로 고정한다. 기간·이동수단 칩은 폭이 넉넉한
                xl 이상에서만 — 어차피 "정보" 패널에 같은 값이 있다. */}
            <div className="mx-auto flex w-full max-w-[1360px] items-center justify-between gap-4 px-6 py-4 xl:gap-6 xl:px-10">
              <div className="flex min-w-0 flex-1 items-center gap-3 xl:gap-4">
                <Link
                  href="/trips"
                  className="flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] pl-2 pr-3 text-[13px] font-semibold text-[color:var(--ink-sub)] hover:bg-[color:var(--card-soft)] hover:text-[color:var(--ink)]"
                >
                  <LuChevronLeft className="size-4" aria-hidden />
                  <span>내 여행</span>
                </Link>
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold tracking-wide text-[color:var(--primary)]">
                    Tripick · 일정
                  </div>
                  <h1 className="mt-0.5 truncate text-[20px] font-bold leading-[28px] text-[color:var(--ink)]">
                    {trip?.title ?? '여행 정보 불러오는 중'}
                  </h1>
                </div>
                {trip ? (
                  <div className="hidden shrink-0 items-center gap-2 whitespace-nowrap xl:flex">
                    <Chip tone="neutral">{trip.meta.durationLabel}</Chip>
                    <Chip tone="neutral">{trip.meta.transportLabel}</Chip>
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2 whitespace-nowrap xl:gap-3">
                {trip ? (
                  <button
                    type="button"
                    onClick={() => setMembersOpen(true)}
                    aria-label="여행 멤버 관리"
                    className="flex items-center gap-2 rounded-full px-2 py-1 transition hover:bg-[color:var(--card-soft)]"
                  >
                    <MemberAvatars members={trip.members} />
                    <LuUserPlus className="size-4 text-[color:var(--ink-faint)]" aria-hidden />
                  </button>
                ) : null}
                {trip ? (
                  <button
                    type="button"
                    onClick={() => setShareOpen(true)}
                    className="flex h-9 items-center gap-1.5 rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-3 text-[13px] font-semibold text-[color:var(--ink-sub)] hover:bg-[color:var(--card-soft)] hover:text-[color:var(--ink)]"
                  >
                    <LuShare2 className="size-4" />
                    공유
                  </button>
                ) : null}
                {trip?.isOwner ? (
                  <DeleteTripButton tripId={trip.id} tripTitle={trip.title} variant="compact" />
                ) : null}
                {trip ? (
                  <button
                    type="button"
                    onClick={() => openReplan('manual')}
                    className="inline-flex h-10 items-center justify-center rounded-[12px] bg-[color:var(--btn-bg)] px-4 text-[14px] font-semibold text-[color:var(--btn-text)] shadow-[var(--shadow-btn)] transition-colors hover:bg-[color:var(--btn-bg-press)]"
                  >
                    <span className="flex items-center gap-1.5">
                      <LuSparkles className="size-4" aria-hidden />
                      AI 재계획
                    </span>
                  </button>
                ) : null}
              </div>
            </div>
          </header>

          {isLiveActive ? <LivePromoBanner /> : null}

          <div
            className={`mx-auto grid h-full w-full min-h-0 max-w-[1360px] gap-5 px-8 py-6 xl:gap-6 xl:px-10 ${
              sidebarVisible
                ? 'grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)] 2xl:grid-cols-[400px_minmax(0,1fr)_360px]'
                : 'grid-cols-[minmax(0,1fr)]'
            }`}
          >
            {/* 좌측: 일정 패널 (2xl 미만에서는 정보·조율 탭도 이곳에서 전환) */}
            {sidebarVisible ? (
              <aside className="flex h-[calc(100dvh-120px)] min-h-0 flex-col overflow-hidden rounded-[20px] border border-[color:var(--line)] bg-[color:var(--card)] shadow-[var(--shadow-card)]">
                <div className="border-b border-[color:var(--line)] px-5 py-4">
                  {trip ? <TripLightSummaryCard trip={trip} compact /> : null}
                  <div className="mt-3 flex items-center justify-between">
                    <h2 className="text-[18px] font-bold leading-[26px] text-[color:var(--ink)]">
                      {activeSidePanel === 'schedule'
                        ? '일정'
                        : activeSidePanel === 'info'
                          ? '여행 정보'
                          : '취향 조율'}
                    </h2>
                    <div className="flex items-center gap-2">
                      {activeSidePanel === 'schedule' ? (
                        <span className="text-[12px] font-semibold text-[color:var(--ink-faint)]">
                          {itemsForDay.length}개
                        </span>
                      ) : null}
                      {/* 2xl 미만: 접어서 지도 넓히기 */}
                      <button
                        type="button"
                        onClick={() => setSidebarCollapsed(true)}
                        aria-label="패널 접기"
                        title="패널 접기"
                        className="flex size-7 items-center justify-center rounded-[8px] text-[color:var(--ink-faint)] hover:bg-[color:var(--card-soft)] hover:text-[color:var(--ink-sub)] 2xl:hidden"
                      >
                        <LuChevronsLeft className="size-4" />
                      </button>
                    </div>
                  </div>
                  {/* 2xl 미만: 우측 정보/조율 컬럼이 없으므로 좌측에서 탭으로 전환 */}
                  {trip ? (
                    <div className="mt-3 flex gap-1 rounded-[12px] bg-[color:var(--card-soft)] p-1 2xl:hidden">
                      {(
                        [
                          { key: 'schedule', label: '일정' },
                          { key: 'info', label: '정보' },
                          { key: 'coordination', label: '조율' },
                        ] as const
                      ).map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setSidePanel(item.key)}
                          className={`h-8 flex-1 rounded-[8px] text-[13px] font-semibold transition ${
                            activeSidePanel === item.key
                              ? 'bg-[color:var(--card)] text-[color:var(--ink)] shadow-[0_1px_3px_rgba(24,33,54,0.08)]'
                              : 'text-[color:var(--ink-faint)] hover:text-[color:var(--ink-sub)]'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {activeSidePanel === 'schedule' ? (
                    <>
                      <p className="mt-3 text-[13px] leading-[20px] text-[color:var(--ink-sub)]">
                        일정을 클릭하면 지도가 이동하고, 변경 아이콘으로 대안을 볼 수 있어요.
                      </p>
                      {trip ? (
                        <div className="mt-3">
                          <DaySelector days={trip.days} value={day} onChange={setDay} />
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {/* key={activeSidePanel} 로 패널 전환 시에만 등장 모션을 재생한다 */}
                  <div key={activeSidePanel} className="app-tab-in">
                    {loadError ? (
                      <div
                        role="alert"
                        className="rounded-[16px] border border-[color:var(--danger-border)] bg-[color:var(--danger-tint)] p-4 text-[14px] text-[color:var(--danger)]"
                      >
                        {loadError}
                      </div>
                    ) : !selectedTripId || !trip ? (
                      <PlannerEmptyState loading={isResolvingTrip} />
                    ) : activeSidePanel === 'info' ? (
                      <TripInfoPanel trip={trip} />
                    ) : activeSidePanel === 'coordination' ? (
                      <TripCoordinationPanel tripId={trip.id} />
                    ) : (
                      <>
                        <PendingProposalsPanel
                          tripId={trip.id}
                          isOwner={isOwner}
                          onOpenProposal={setPreviewProposalId}
                        />
                        <EditableTimeline
                          tripId={trip.id}
                          day={day}
                          items={itemsForDay}
                          selectedItemId={focusedItemId}
                          onSelectItem={(item) => setFocusedItemId(item.id)}
                          onSwitchItem={setOpenItem}
                          isOwner={isOwner}
                          onProposed={handleProposed}
                        />
                      </>
                    )}
                  </div>
                </div>
                <div className="border-t border-[color:var(--line)] bg-[color:var(--card-soft)] px-5 py-3 text-[12px] text-[color:var(--ink-sub)]">
                  일정을 클릭하면 지도에서 초점이 맞춰지고, 변경 아이콘을 누르면 대안 시트가
                  열립니다.
                </div>
              </aside>
            ) : null}

            {/* 중앙: 큰 지도 */}
            <main className="relative flex h-[calc(100dvh-120px)] min-h-0 flex-col overflow-hidden rounded-[20px] border border-[color:var(--line)] bg-[color:var(--card)] shadow-[var(--shadow-card)]">
              {/* 패널 접힘 상태: 지도 좌측 가장자리에 펼치기 핸들 (검색바와 겹치지 않게) */}
              {!sidebarVisible ? (
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(false)}
                  aria-label="일정 패널 펼치기"
                  title="일정 패널 펼치기"
                  className="absolute left-0 top-1/2 z-20 flex -translate-y-1/2 items-center rounded-r-[12px] border border-l-0 border-[color:var(--line)] bg-[color:var(--card)] py-4 pl-1 pr-1.5 text-[color:var(--ink-sub)] shadow-[0_4px_12px_rgba(15,23,42,0.1)] hover:bg-[color:var(--card-soft)] hover:text-[color:var(--ink)]"
                >
                  <LuChevronsRight className="size-5" />
                </button>
              ) : null}
              {trip ? (
                <PlannerMap
                  placeholder={trip.searchPlaceholder}
                  center={mapCenter}
                  markers={dayMarkers}
                  fitMarkers={!focusedMarker}
                  selectedMarkerId={focusedMarkerId}
                  showCurrentDot={false}
                  fill
                  onMarkerClick={(marker) => {
                    if (!marker.itemId) return;
                    setFocusedItemId(marker.itemId);
                  }}
                  onPickSearchPlace={handlePickSearchPlace}
                  pickPlaceLabel={pickPlaceLabel}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center bg-[color:var(--card-soft)] px-6 text-center text-[14px] font-semibold text-[color:var(--ink-faint)]">
                  {isResolvingTrip ? '내 여행을 찾는 중' : '새 여행을 만들면 지도가 표시돼요'}
                </div>
              )}
            </main>

            {/* 우측: 정보 + 조율 패널 (2xl+) */}
            <aside className="hidden h-[calc(100dvh-120px)] min-h-0 space-y-4 overflow-y-auto 2xl:block">
              {trip ? <TripInfoPanel trip={trip} /> : null}
              {trip ? <TripCoordinationPanel tripId={trip.id} /> : null}
            </aside>
          </div>
        </div>
      </div>

      <AlternativeSheet
        tripId={trip?.id ?? selectedTripId}
        open={openItem !== null}
        item={openItem}
        onClose={() => setOpenItem(null)}
        onApplied={(name, itemId) => setSwapResult({ id: itemId, name })}
        isOwner={isOwner}
        onProposed={handleProposed}
      />

      <TripMembersSheet
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        tripId={trip?.id ?? selectedTripId}
        tripTitle={trip?.title ?? '여행'}
        members={trip?.members ?? []}
        isOwner={isOwner}
      />

      {trip ? (
        <ShareTripSheet
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          tripId={trip.id}
          tripTitle={trip.title}
          subtitle={`${trip.meta.durationLabel} · ${trip.meta.transportLabel}`}
          days={trip.days}
          items={trip.items}
          canShareLink={trip.isOwner}
        />
      ) : null}

      <ReplanModal
        tripId={trip?.id ?? selectedTripId}
        open={replanOpen}
        onClose={() => setReplanOpen(false)}
        days={trip?.days ?? []}
        // 보고 있던 일차를 기본 범위로 — 알림 딥링크(?day=)로 들어온 경우도 그 일차가 잡힌다.
        defaultDay={day}
        isOwner={isOwner}
        trigger={replanTrigger}
        onProposed={handleProposed}
        // deduped = 이미 도는 재계획에 합쳐진 요청. 같은 토스트를 띄우면 이번에 적은 요청이
        // 반영된 줄 알고 결과를 기다리게 되므로 진행 중임을 분명히 말한다.
        onRequested={(scopeLabel, deduped) =>
          setPlaceToast(
            deduped
              ? {
                  tone: 'primary',
                  title: '이미 재계획이 진행 중이에요',
                  message:
                    '지금 요청은 진행 중인 재계획에 합쳐졌어요. 완료된 뒤 다시 요청해 주세요.',
                }
              : {
                  tone: 'success',
                  title: `AI가 ${scopeLabel}을 다시 짜고 있어요`,
                  message: '완료되면 일정에 자동으로 반영돼요.',
                },
          )
        }
      />

      {/* 승인/거절은 owner 전용 — 비-owner 가 ?proposalId 딥링크로 와도 열지 않는다 */}
      {previewProposalId && trip && isOwner ? (
        <ScheduleChangePreviewModal
          proposalId={previewProposalId}
          tripItems={trip.items}
          onClose={() => setPreviewProposalId(null)}
        />
      ) : null}

      {selectedTripId ? <ReplanToast tripId={selectedTripId} /> : null}

      {/* 알림(날씨·혼잡·미도착) 딥링크로 열린 경우에만 뜨는 비침습 배너.
          두 반응형 레이아웃 공통으로 상단 중앙에 떠 있고, 닫으면 그냥 일정을 본다. */}
      {alertBanner && alertBanner !== 'manual' && trip ? (
        <div className="fixed left-1/2 top-[calc(12px+var(--safe-top))] z-40 w-[calc(100%-24px)] max-w-[420px] -translate-x-1/2">
          <div className="flex items-start gap-3 rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card)] p-3.5 shadow-[var(--shadow-btn)]">
            {(() => {
              const BannerIcon = REPLAN_BANNER_COPY[alertBanner].Icon;
              return (
                <BannerIcon
                  className="mt-0.5 size-5 shrink-0 text-[color:var(--primary)]"
                  aria-hidden
                />
              );
            })()}
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-[color:var(--ink)]">
                {REPLAN_BANNER_COPY[alertBanner].title}
              </p>
              <p className="mt-0.5 text-[12.5px] text-[color:var(--ink-sub)]">
                {REPLAN_BANNER_COPY[alertBanner].body}
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const trigger = alertBanner;
                    dismissAlertBanner();
                    openReplan(trigger);
                  }}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[12px] bg-[color:var(--btn-bg)] px-3.5 text-[13px] font-semibold text-[color:var(--btn-text)] shadow-[var(--shadow-btn)] transition-colors hover:bg-[color:var(--btn-bg-press)]"
                >
                  <LuSparkles className="size-4" aria-hidden />
                  AI 재계획
                </button>
                <button
                  type="button"
                  onClick={dismissAlertBanner}
                  className="inline-flex h-9 items-center justify-center rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-3.5 text-[13px] font-semibold text-[color:var(--ink-sub)] transition-colors hover:bg-[color:var(--card-soft)] hover:text-[color:var(--ink)]"
                >
                  닫기
                </button>
              </div>
            </div>
            <button
              type="button"
              aria-label="배너 닫기"
              onClick={dismissAlertBanner}
              className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-[color:var(--ink-faint)] hover:bg-[color:var(--card-soft)] hover:text-[color:var(--ink)]"
            >
              <LuX className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      {placeToast ? (
        <Toast
          tone={placeToast.tone}
          title={placeToast.title}
          {...(placeToast.message ? { message: placeToast.message } : {})}
          onClose={() => setPlaceToast(null)}
        />
      ) : null}
    </div>
  );
}

function LivePromoBanner() {
  return (
    <Link
      href="/trip/live"
      className="flex items-center justify-between gap-3 px-4 py-2.5 text-[color:var(--btn-text)] transition"
      style={{ background: 'var(--btn-bg)' }}
    >
      <span className="flex items-center gap-2 text-[13px] font-bold">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full motion-safe:animate-ping rounded-full bg-white/70" />
          <span className="relative inline-flex size-2 rounded-full bg-white" />
        </span>
        지금 여행 중이에요
      </span>
      <span className="flex items-center gap-0.5 text-[12px] font-semibold">
        실시간 화면 보기
        <LuChevronRight className="size-3.5" aria-hidden />
      </span>
    </Link>
  );
}

function PlannerEmptyState({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card-soft)] px-4 py-5 text-[14px] font-semibold text-[color:var(--ink-faint)]">
        내 여행을 불러오고 있어요.
      </div>
    );
  }

  return (
    <div className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card-soft)] px-4 py-5">
      <div className="text-[12px] font-bold text-[color:var(--primary)]">내 여행</div>
      <h2 className="mt-1 text-[18px] font-bold text-[color:var(--ink)]">
        여행을 먼저 만들어주세요
      </h2>
      <p className="mt-1 text-[13px] leading-5 text-[color:var(--ink-sub)]">
        일정·지도·취향 조율은 여행 단위로 저장됩니다.
      </p>
      <Link
        href="/trips/new"
        className="mt-4 inline-flex h-10 items-center rounded-full px-4 text-[13px] font-bold text-[color:var(--btn-text)]"
        style={{ background: 'var(--btn-bg)' }}
      >
        새 여행 만들기
      </Link>
    </div>
  );
}
