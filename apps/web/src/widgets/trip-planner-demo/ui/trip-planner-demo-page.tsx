'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type {
  ItineraryItemDto,
  LoginResponseDto,
  ReplanJobDto,
  ReplanResultDto,
  TripDto,
} from '@tripick/types';

import { api } from '@/lib/api';
import { disconnect, joinTrip, onReplanResult } from '@/lib/socket';

type Step = 'landing' | 'taste' | 'trip' | 'result';
type TransportMode = 'walk' | 'transit' | 'car';
type ReplanMode = 'manual' | 'waiting';
type RetryAction = 'demo-start' | 'save-taste' | 'create-trip' | 'replan' | null;

type TasteState = {
  food: string[];
  mood: string[];
  environment: string[];
};

type TripFormState = {
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  wakeTime: string;
  sleepTime: string;
  transportMode: TransportMode;
};

type ReplanState = {
  trigger: ReplanMode;
  waitingMinutes: string;
  note: string;
};

type ChangedItem = {
  before?: ItineraryItemDto;
  after: ItineraryItemDto;
};

const FOOD_OPTIONS = [
  { value: 'korean', label: '한식 중심' },
  { value: 'japanese', label: '일식 취향' },
  { value: 'western', label: '양식도 좋아요' },
  { value: 'cafe', label: '카페는 꼭' },
  { value: 'vegan', label: '가벼운 식사 선호' },
  { value: 'chinese', label: '중식도 괜찮아요' },
] as const;

const MOOD_OPTIONS = [
  { value: 'healing', label: '천천히 힐링' },
  { value: 'adventure', label: '움직임 많은 일정' },
  { value: 'romantic', label: '감도 있는 데이트' },
  { value: 'family', label: '부담 적은 동선' },
  { value: 'cultural', label: '전시·로컬 탐방' },
] as const;

const ENVIRONMENT_OPTIONS = [
  { value: 'city', label: '도시 중심' },
  { value: 'nature', label: '자연 위주' },
  { value: 'beach', label: '바다 가까이' },
  { value: 'mountain', label: '산·숲 선호' },
  { value: 'village', label: '골목과 로컬' },
] as const;

const TRANSPORT_OPTIONS: Array<{ value: TransportMode; label: string; helper: string }> = [
  { value: 'transit', label: '대중교통', helper: '도심 이동이 자연스럽게 이어지도록 맞춥니다' },
  { value: 'walk', label: '도보 중심', helper: '가까운 동선 위주로 여유 있게 묶어드립니다' },
  { value: 'car', label: '차량 이동', helper: '넓은 반경도 끊김 없이 연결합니다' },
];

const REPLAN_OPTIONS: Array<{ value: ReplanMode; label: string; helper: string }> = [
  {
    value: 'manual',
    label: '분위기만 다시 조정',
    helper: '지금 취향을 유지한 채 다른 흐름으로 다시 추천합니다',
  },
  {
    value: 'waiting',
    label: '웨이팅이 길어요',
    helper: '대기 시간을 반영해 앞뒤 순서를 다시 맞춥니다',
  },
];

const INITIAL_TASTE: TasteState = {
  food: ['korean', 'cafe'],
  mood: ['healing'],
  environment: ['city'],
};

const INITIAL_TRIP: TripFormState = {
  title: '부산 1박 2일 감도 여행',
  destination: '부산',
  startDate: '2026-05-10',
  endDate: '2026-05-11',
  wakeTime: '08:30',
  sleepTime: '22:30',
  transportMode: 'transit',
};

const INITIAL_REPLAN: ReplanState = {
  trigger: 'waiting',
  waitingMinutes: '20',
  note: '카페 웨이팅이 길어져서 주변 일정부터 보고 싶어요.',
};

export default function HomePage() {
  const [step, setStep] = useState<Step>('landing');
  const [session, setSession] = useState<LoginResponseDto | null>(null);
  const [taste, setTaste] = useState<TasteState>(INITIAL_TASTE);
  const [tripForm, setTripForm] = useState<TripFormState>(INITIAL_TRIP);
  const [replan, setReplan] = useState<ReplanState>(INITIAL_REPLAN);
  const [trip, setTrip] = useState<TripDto | null>(null);
  const [itinerary, setItinerary] = useState<ItineraryItemDto[]>([]);
  const [previousItinerary, setPreviousItinerary] = useState<ItineraryItemDto[]>([]);
  const [replanResult, setReplanResult] = useState<ReplanResultDto | null>(null);
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<RetryAction>(null);
  const [replanCount, setReplanCount] = useState(0);
  const subscriptionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      subscriptionRef.current?.();
      disconnect();
    };
  }, []);

  const canSubmitTaste =
    taste.food.length > 0 && taste.mood.length > 0 && taste.environment.length > 0;
  const canSubmitTrip =
    tripForm.title.trim().length > 0 &&
    tripForm.destination.trim().length > 0 &&
    tripForm.startDate.length > 0 &&
    tripForm.endDate.length > 0 &&
    tripForm.wakeTime < tripForm.sleepTime &&
    tripForm.startDate <= tripForm.endDate;
  const canSubmitReplan = replan.trigger === 'manual' || Number(replan.waitingMinutes) > 0;

  const selectedTasteSummary = [taste.food[0], taste.mood[0], taste.environment[0]]
    .filter(Boolean)
    .join(' · ');
  const selectedTasteLabels = [
    optionLabel(FOOD_OPTIONS, taste.food[0]),
    optionLabel(MOOD_OPTIONS, taste.mood[0]),
    optionLabel(ENVIRONMENT_OPTIONS, taste.environment[0]),
  ].filter(Boolean) as string[];

  const groupedDays = useMemo(() => {
    const map = new Map<number, ItineraryItemDto[]>();
    for (const item of itinerary) {
      const list = map.get(item.day) ?? [];
      list.push(item);
      map.set(item.day, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [itinerary]);

  const changedItems = useMemo<ChangedItem[]>(() => {
    if (previousItinerary.length === 0 || itinerary.length === 0) {
      return [];
    }

    const prevBySlot = new Map(previousItinerary.map((item) => [slotKey(item), item]));
    return itinerary
      .map((item) => {
        const before = prevBySlot.get(slotKey(item));
        if (!before) {
          return { after: item };
        }
        if (
          before.name !== item.name ||
          before.scheduledAt !== item.scheduledAt ||
          before.memo !== item.memo
        ) {
          return { before, after: item };
        }
        return null;
      })
      .filter((item): item is ChangedItem => item !== null);
  }, [itinerary, previousItinerary]);

  const heroChips = useMemo(
    () => [
      {
        label: '흐름',
        value:
          step === 'landing'
            ? '데모 진입'
            : step === 'taste'
              ? '취향 입력'
              : step === 'trip'
                ? '여행 조건'
                : '일정 결과',
      },
      { label: '기준', value: selectedTasteLabels[0] ?? '한식 중심' },
      { label: '이동', value: transportLabel(tripForm.transportMode) },
    ],
    [selectedTasteLabels, step, tripForm.transportMode],
  );

  async function handleDemoStart() {
    setRetryAction('demo-start');
    setLoadingLabel('데모 세션을 준비하고 있어요');
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const sessionResponse = await api.post<LoginResponseDto>('/auth/demo', {
        nickname: 'tripick-demo',
      });
      setSession(sessionResponse);
      setStep('taste');
      setStatusMessage('데모 세션이 준비됐어요. 취향만 고르면 일정 생성까지 바로 이어집니다.');
      setRetryAction(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, '데모 세션을 준비하지 못했습니다.'));
    } finally {
      setLoadingLabel(null);
    }
  }

  async function handleSaveTaste() {
    if (!session || !canSubmitTaste) {
      return;
    }

    setRetryAction('save-taste');
    setLoadingLabel('취향을 저장하고 있어요');
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await api.put(
        '/preferences',
        {
          tasteTags: {
            food: taste.food,
            mood: taste.mood,
            environment: taste.environment,
            confidence: 0.92,
          },
        },
        session.tokens.accessToken,
      );
      setStep('trip');
      setStatusMessage('취향을 저장했어요. 이제 여행 조건만 입력하면 바로 일정을 만듭니다.');
      setRetryAction(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, '취향 저장에 실패했습니다.'));
    } finally {
      setLoadingLabel(null);
    }
  }

  async function handleCreateTrip() {
    if (!session || !canSubmitTrip) {
      return;
    }

    setRetryAction('create-trip');
    setLoadingLabel('취향을 반영해 일정 초안을 만들고 있어요');
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const createdTrip = await api.post<TripDto>('/trips', tripForm, session.tokens.accessToken);
      const items = await api.get<ItineraryItemDto[]>(
        `/trips/${createdTrip.id}/itinerary`,
        session.tokens.accessToken,
      );
      attachRealtime(createdTrip.id);
      setTrip(createdTrip);
      setItinerary(items);
      setPreviousItinerary([]);
      setReplanResult(null);
      setReplanCount(0);
      setStep('result');
      setStatusMessage('일정이 준비됐어요. 결과를 확인하고 바로 재계획도 테스트할 수 있습니다.');
      setRetryAction(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, '일정 생성에 실패했습니다.'));
    } finally {
      setLoadingLabel(null);
    }
  }

  async function handleReplan() {
    if (!session || !trip || !canSubmitReplan) {
      return;
    }

    setRetryAction('replan');
    setLoadingLabel(
      replan.trigger === 'waiting'
        ? '웨이팅을 반영해 순서를 다시 조정하고 있어요'
        : '현재 취향 기준으로 다른 흐름을 제안하고 있어요',
    );
    setErrorMessage(null);
    setStatusMessage(null);
    setPreviousItinerary(itinerary);
    setReplanResult(null);

    try {
      const body = {
        tripId: trip.id,
        trigger: replan.trigger,
        waitingMinutes: replan.trigger === 'waiting' ? Number(replan.waitingMinutes) : undefined,
        context: replan.note.trim() ? { note: replan.note.trim() } : undefined,
      };

      if (replan.trigger === 'waiting') {
        await api.post('/alternative/waiting', body, session.tokens.accessToken);
      } else {
        await api.post<ReplanResultDto | ReplanJobDto>(
          '/replanning',
          body,
          session.tokens.accessToken,
        );
      }

      const refreshed = await waitForUpdatedItinerary({
        accessToken: session.tokens.accessToken,
        tripId: trip.id,
        baseline: itinerary,
      });

      setItinerary(refreshed);
      setReplanCount((count) => count + 1);
      setStatusMessage(
        replan.trigger === 'waiting'
          ? '대기 시간을 반영해 더 자연스러운 순서로 다시 정리했어요.'
          : '현재 여행 톤을 유지하면서 새로운 구성으로 다시 정리했어요.',
      );
      setRetryAction(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, '재계획 요청에 실패했습니다.'));
    } finally {
      setLoadingLabel(null);
    }
  }

  function attachRealtime(tripId: string) {
    subscriptionRef.current?.();
    disconnect();
    joinTrip(tripId);
    subscriptionRef.current = onReplanResult((result) => {
      if (result.tripId !== tripId) {
        return;
      }
      setReplanResult(result);
      if (result.updatedItems && result.updatedItems.length > 0) {
        setItinerary(result.updatedItems);
        setReplanCount((count) => count + 1);
      }
      setStatusMessage(result.explanation ?? '실시간 재계획 결과가 도착했어요.');
      setLoadingLabel(null);
      setRetryAction(null);
    });
  }

  function handleRetry() {
    switch (retryAction) {
      case 'demo-start':
        void handleDemoStart();
        break;
      case 'save-taste':
        void handleSaveTaste();
        break;
      case 'create-trip':
        void handleCreateTrip();
        break;
      case 'replan':
        void handleReplan();
        break;
      default:
        break;
    }
  }

  return (
    <main className="min-h-screen bg-transparent text-[color:var(--text-primary)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[520px] flex-col px-4 pb-10 pt-5 sm:px-5 sm:pb-12 sm:pt-6">
        <HeroShell
          chips={heroChips}
          sessionLabel={
            session
              ? `${session.user.nickname} 님 데모 세션으로 진행 중`
              : '로그인 없이 바로 데모 플로우를 확인할 수 있어요'
          }
          step={step}
        />

        <div className="mt-5 space-y-4 sm:space-y-5">
          {step === 'landing' ? (
            <LandingSection loading={loadingLabel !== null} onStart={handleDemoStart} />
          ) : null}

          {step === 'taste' ? (
            <>
              <SectionHero
                eyebrow="1/3 취향 입력"
                title="질문 몇 개로 여행 톤을 먼저 정할게요"
                description="음식, 분위기, 환경 세 축만 고르면 일정 추천 방향이 빠르게 정리됩니다."
              />
              <ProgressCard current={1} total={3} />
              <CompactSummaryCard
                title="현재 선택한 여행 톤"
                description={selectedTasteLabels.join(' · ') || '아직 선택 전'}
              />
              <QuestionCard
                title="음식 취향"
                description="가장 기대하는 식사 톤을 골라주세요"
                options={FOOD_OPTIONS}
                selected={taste.food}
                onToggle={(value) => toggleSelection(setTaste, 'food', value)}
              />
              <QuestionCard
                title="여행 분위기"
                description="일정의 리듬을 결정하는 선택입니다"
                options={MOOD_OPTIONS}
                selected={taste.mood}
                onToggle={(value) => toggleSelection(setTaste, 'mood', value)}
              />
              <QuestionCard
                title="선호 환경"
                description="자주 머무르고 싶은 공간을 고르면 돼요"
                options={ENVIRONMENT_OPTIONS}
                selected={taste.environment}
                onToggle={(value) => toggleSelection(setTaste, 'environment', value)}
              />
              <PrimaryActionBar
                helper={
                  canSubmitTaste
                    ? '세 축이 모두 선택돼서 다음 단계로 넘어갈 수 있어요.'
                    : '음식·분위기·환경을 각각 하나 이상 선택해주세요.'
                }
                disabled={!canSubmitTaste || loadingLabel !== null}
                label="여행 조건 입력으로 이동"
                onClick={handleSaveTaste}
              />
            </>
          ) : null}

          {step === 'trip' ? (
            <>
              <SectionHero
                eyebrow="2/3 여행 조건 입력"
                title="일정에 꼭 필요한 조건만 빠르게 입력해주세요"
                description="목적지, 날짜, 생활 리듬, 이동 방식 네 가지만 정리하면 바로 결과를 만듭니다."
              />
              <ProgressCard current={2} total={3} />
              <CompactSummaryCard
                title="이번 추천 기준"
                description={`${selectedTasteLabels.join(' · ') || '기본 취향'} · ${transportLabel(tripForm.transportMode)}`}
              />
              <SurfaceCard>
                <SectionTitle
                  title="기본 정보"
                  description="줄바꿈이 어색하지 않도록 핵심 입력만 한 화면에 정리했습니다."
                />
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <InputField
                      label="여행 이름"
                      value={tripForm.title}
                      onChange={(value) => setTripForm((current) => ({ ...current, title: value }))}
                      placeholder="예: 부산 1박 2일 감도 여행"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <InputField
                      label="목적지"
                      value={tripForm.destination}
                      onChange={(value) =>
                        setTripForm((current) => ({ ...current, destination: value }))
                      }
                      placeholder="예: 부산"
                    />
                  </div>
                  <InputField
                    label="시작일"
                    type="date"
                    value={tripForm.startDate}
                    onChange={(value) =>
                      setTripForm((current) => ({ ...current, startDate: value }))
                    }
                  />
                  <InputField
                    label="종료일"
                    type="date"
                    value={tripForm.endDate}
                    onChange={(value) => setTripForm((current) => ({ ...current, endDate: value }))}
                  />
                  <InputField
                    label="기상 시간"
                    type="time"
                    value={tripForm.wakeTime}
                    onChange={(value) =>
                      setTripForm((current) => ({ ...current, wakeTime: value }))
                    }
                  />
                  <InputField
                    label="취침 시간"
                    type="time"
                    value={tripForm.sleepTime}
                    onChange={(value) =>
                      setTripForm((current) => ({ ...current, sleepTime: value }))
                    }
                  />
                </div>
              </SurfaceCard>

              <SurfaceCard>
                <SectionTitle
                  title="이동 방식"
                  description="v1에서는 한 가지 기준 이동 수단만 우선 반영합니다."
                />
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {TRANSPORT_OPTIONS.map((option) => {
                    const active = tripForm.transportMode === option.value;
                    return (
                      <SelectablePanel
                        key={option.value}
                        active={active}
                        label={option.label}
                        helper={option.helper}
                        onClick={() =>
                          setTripForm((current) => ({ ...current, transportMode: option.value }))
                        }
                      />
                    );
                  })}
                </div>
              </SurfaceCard>

              <PrimaryActionBar
                helper={
                  canSubmitTrip
                    ? '목적지와 날짜, 생활 리듬이 모두 정리됐어요.'
                    : '여행 이름, 목적지, 날짜를 입력하고 기상 시간이 취침 시간보다 이르게 맞춰주세요.'
                }
                disabled={!canSubmitTrip || loadingLabel !== null}
                label="일정 만들기"
                onClick={handleCreateTrip}
              />
            </>
          ) : null}

          {step === 'result' ? (
            <>
              <ResultHero
                trip={trip}
                tasteLabels={selectedTasteLabels}
                transportMode={tripForm.transportMode}
                replanCount={replanCount}
              />

              <div className="grid gap-4">
                <SurfaceCard className="overflow-hidden">
                  <SectionTitle
                    title="여행 요약"
                    description="이번 일정에서 먼저 보면 좋은 정보만 추려두었습니다."
                  />
                  <div className="mt-5 grid gap-3 min-[390px]:grid-cols-3">
                    <MetricTile
                      label="여행 기간"
                      value={trip ? formatDateRange(trip.startDate, trip.endDate) : '-'}
                    />
                    <MetricTile label="이동 기준" value={transportLabel(tripForm.transportMode)} />
                    <MetricTile
                      label="추천 톤"
                      value={selectedTasteLabels.join(' · ') || '기본 세팅'}
                    />
                  </div>
                </SurfaceCard>
                <SurfaceCard>
                  <SectionTitle
                    title="재계획 준비 상태"
                    description="현재 설정된 기준으로 언제든 다시 조정할 수 있습니다."
                  />
                  <div className="mt-4 space-y-3">
                    <InfoRow
                      label="현재 모드"
                      value={replan.trigger === 'waiting' ? '웨이팅 기준 재정렬' : '분위기 재조정'}
                    />
                    <InfoRow
                      label="대기 시간"
                      value={
                        replan.trigger === 'waiting'
                          ? `${replan.waitingMinutes || '0'}분`
                          : '해당 없음'
                      }
                    />
                    <InfoRow label="추가 메모" value={replan.note.trim() || '메모 없음'} />
                  </div>
                </SurfaceCard>
              </div>

              {groupedDays.length > 0 ? (
                groupedDays.map(([day, items]) => (
                  <DaySectionCard key={day} day={day} items={items} changedItems={changedItems} />
                ))
              ) : (
                <EmptyState
                  title="아직 불러온 일정이 없어요"
                  description="일정 생성이 끝나면 day 카드와 타임라인이 이 영역에 표시됩니다."
                />
              )}

              <SurfaceCard>
                <SectionTitle
                  title="재계획 요청"
                  description="대기 상황이나 지금 분위기에 맞춰 다음 흐름을 다시 추천해드려요."
                />
                <div className="mt-5 grid gap-3">
                  {REPLAN_OPTIONS.map((option) => {
                    const active = replan.trigger === option.value;
                    return (
                      <SelectablePanel
                        key={option.value}
                        active={active}
                        label={option.label}
                        helper={option.helper}
                        onClick={() =>
                          setReplan((current) => ({ ...current, trigger: option.value }))
                        }
                      />
                    );
                  })}
                </div>
                <div className="mt-5 grid gap-4">
                  {replan.trigger === 'waiting' ? (
                    <InputField
                      label="예상 대기 시간(분)"
                      type="number"
                      value={replan.waitingMinutes}
                      onChange={(value) =>
                        setReplan((current) => ({ ...current, waitingMinutes: value }))
                      }
                      placeholder="20"
                    />
                  ) : (
                    <CalloutBox
                      title="분위기 재조정"
                      description="대기 시간 입력 없이 현재 일정 톤만 유지한 채 다른 흐름을 제안합니다."
                    />
                  )}
                  <InputField
                    label="추가 메모"
                    value={replan.note}
                    onChange={(value) => setReplan((current) => ({ ...current, note: value }))}
                    placeholder="예: 웨이팅이 길어져서 산책 가능한 장소를 먼저 가고 싶어요"
                  />
                </div>
                <div className="mt-5 grid gap-3 rounded-[20px] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-4 min-[390px]:grid-cols-3">
                  <MetricTile label="다음 결과" value="변경 포인트 비교" compact />
                  <MetricTile label="표시 방식" value="Day 카드 유지" compact />
                  <MetricTile label="실패 시 UX" value="친화적 에러 안내" compact />
                </div>
              </SurfaceCard>

              <PrimaryActionBar
                helper={
                  canSubmitReplan
                    ? replan.trigger === 'waiting'
                      ? '웨이팅 시간을 반영해 일정 순서를 다시 계산합니다.'
                      : '현재 일정의 톤을 유지하며 새 구성을 요청합니다.'
                    : '웨이팅 재계획은 대기 시간을 1분 이상 입력해야 합니다.'
                }
                disabled={!canSubmitReplan || loadingLabel !== null}
                label={
                  replan.trigger === 'waiting'
                    ? '웨이팅 기준으로 다시 짜기'
                    : '지금 일정 다시 정리하기'
                }
                onClick={handleReplan}
                sticky={false}
              />

              {changedItems.length > 0 ? (
                <SurfaceCard>
                  <SectionTitle
                    title="재계획 후 달라진 일정"
                    description="무엇이 바뀌었는지 즉시 읽히도록 전후 비교만 남겼습니다."
                  />
                  <div className="mt-5 space-y-3">
                    {changedItems.map((changed) => (
                      <div
                        key={changed.after.id}
                        className="rounded-[22px] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-4 sm:p-5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <StatusChip tone="brand">Day {changed.after.day}</StatusChip>
                          <div className="text-[13px] font-semibold leading-[18px] text-[color:var(--text-secondary)]">
                            {formatTime(changed.after.scheduledAt)}
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 min-[390px]:grid-cols-2">
                          <ComparisonBlock
                            title="이전"
                            item={changed.before}
                            tone="muted"
                            emptyLabel="기존 항목 없음"
                          />
                          <ComparisonBlock
                            title="변경 후"
                            item={changed.after}
                            tone="active"
                            emptyLabel="변경 항목 없음"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </SurfaceCard>
              ) : null}
            </>
          ) : null}

          {loadingLabel ? <LoadingCard label={loadingLabel} /> : null}
          {statusMessage ? (
            <StatusCard tone="success" title="진행 상태" description={statusMessage} />
          ) : null}
          {replanResult?.explanation ? (
            <StatusCard tone="info" title="재계획 설명" description={replanResult.explanation} />
          ) : null}
          {errorMessage ? (
            <StatusCard
              {...(retryAction
                ? { actionLabel: '같은 조건으로 다시 시도', onAction: handleRetry }
                : {})}
              tone="error"
              title="다시 확인이 필요해요"
              description={errorMessage}
            />
          ) : null}

          {step !== 'result' ? (
            <QuickGuide
              step={step}
              tasteLabels={selectedTasteLabels}
              transportMode={tripForm.transportMode}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function HeroShell({
  step,
  sessionLabel,
  chips,
}: {
  step: Step;
  sessionLabel: string;
  chips: Array<{ label: string; value: string }>;
}) {
  return (
    <section className="overflow-hidden rounded-[20px] border border-[color:var(--line)] bg-white px-5 py-5 shadow-[var(--shadow-md)] sm:px-6">
      <div className="flex flex-col gap-4">
        <div className="max-w-[700px]">
          <div className="inline-flex items-center rounded-full border border-[color:var(--line)] bg-white/80 px-3 py-1 text-[12px] font-semibold leading-[16px] tracking-[0.02em] text-[color:var(--primary)]">
            TriPick v1 demo · {labelForStep(step)}
          </div>
          <h1 className="mt-3 max-w-[12ch] text-[clamp(1.75rem,7vw,2.35rem)] font-[700] leading-[1.2] tracking-[-0.03em] text-[color:var(--text-primary)]">
            취향으로 골라주는 여행 플래너
          </h1>
          <p className="mt-3 max-w-[32rem] text-[1rem] leading-[1.6] text-[color:var(--text-secondary)]">
            랜딩부터 취향 입력, 여행 조건, 결과, 재계획까지 하나의 제품 흐름처럼 연결되도록 화면
            위계와 타이포를 다시 정리했습니다.
          </p>
          <p className="mt-3 text-[14px] leading-[22px] text-[color:var(--text-tertiary)]">
            {sessionLabel}
          </p>
        </div>
        <div className="grid gap-3 min-[360px]:grid-cols-3">
          {chips.map((chip) => (
            <div
              key={chip.label}
              className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-4 py-4"
            >
              <div className="text-[12px] font-semibold leading-[16px] text-[color:var(--text-tertiary)]">
                {chip.label}
              </div>
              <div className="mt-2 text-[0.95rem] font-semibold leading-[1.35] text-[color:var(--text-primary)]">
                {chip.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LandingSection({ loading, onStart }: { loading: boolean; onStart: () => void }) {
  return (
    <>
      <SectionHero
        eyebrow="로그인 없이 바로 체험"
        title="질문 몇 개만 답하면 여행 계획이 쉬워져요"
        description="복잡한 메뉴 대신 실제 제품 흐름과 비슷한 4단계만 남겨서 빠르게 데모를 확인할 수 있습니다."
      />

      <div className="grid gap-4">
        <SurfaceCard>
          <SectionTitle
            title="데모에서 바로 확인되는 핵심"
            description="정보 위계를 단순하게 유지하면서 결과까지 한 번에 이어집니다."
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              { title: '취향 입력', description: '음식·분위기·환경 세 축으로 여행 톤을 잡습니다.' },
              { title: '여행 조건', description: '목적지, 날짜, 생활 리듬만 빠르게 입력합니다.' },
              {
                title: '결과 카드',
                description: 'Day 중심 카드로 장소, 시간, 이동 정보를 스캔합니다.',
              },
              { title: '재계획 요청', description: '웨이팅과 분위기 변경을 바로 확인합니다.' },
            ].map((item) => (
              <FeatureTile key={item.title} title={item.title} description={item.description} />
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <SectionTitle
            title="결과 미리보기"
            description="텍스트가 좁은 화면에서도 어색하게 끊기지 않도록 line-height와 폭을 맞췄습니다."
          />
          <div className="mt-5 rounded-[26px] border border-[color:var(--line)] bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_100%)] p-4 shadow-[var(--shadow-md)] sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <StatusChip tone="brand">Day 1 부산 감도 코스</StatusChip>
                <div className="mt-3 max-w-[15ch] text-[clamp(1.15rem,2vw,1.45rem)] font-bold leading-[1.25] tracking-[-0.03em] text-[color:var(--text-primary)]">
                  광안리 산책부터 저녁 식사까지
                </div>
              </div>
              <StatusChip tone="muted">3개 일정</StatusChip>
            </div>
            <div className="mt-4 space-y-3">
              {[
                '10:00 광안리 산책 · 이동 부담 낮은 시작',
                '12:30 로컬 식당 · 취향 태그 반영',
                '15:00 카페 휴식 · 웨이팅 시 재계획 가능',
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-[20px] border border-[color:var(--line)] bg-white px-4 py-3 text-[15px] leading-[22px] text-[color:var(--text-secondary)]"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </SurfaceCard>
      </div>

      <PrimaryActionBar
        helper="지금은 로그인 없이 데모 세션으로 바로 체험할 수 있어요."
        disabled={loading}
        label="취향 입력하고 시작하기"
        onClick={onStart}
        secondaryLabel="실서비스 로그인 연동은 다음 단계에서 연결됩니다"
        sticky={false}
      />
    </>
  );
}

function SectionHero({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="rounded-[20px] border border-[color:var(--line)] bg-white px-5 py-5 shadow-[var(--shadow-md)] sm:px-6">
      <div className="text-[12px] font-semibold leading-[16px] tracking-[0.02em] text-[color:var(--primary)]">
        {eyebrow}
      </div>
      <h2 className="mt-3 text-[clamp(1.5rem,5.8vw,2rem)] font-[700] leading-[1.3] tracking-[-0.03em] text-[color:var(--text-primary)]">
        {title}
      </h2>
      <p className="mt-3 max-w-[44rem] text-[clamp(0.97rem,1.45vw,1.08rem)] leading-[1.68] text-[color:var(--text-secondary)]">
        {description}
      </p>
    </section>
  );
}

function ResultHero({
  trip,
  tasteLabels,
  transportMode,
  replanCount,
}: {
  trip: TripDto | null;
  tasteLabels: string[];
  transportMode: TransportMode;
  replanCount: number;
}) {
  return (
    <section className="overflow-hidden rounded-[20px] border border-[color:var(--line)] bg-[color:var(--primary)] px-5 py-5 text-white shadow-[var(--shadow-md)] sm:px-6">
      <div className="flex flex-col gap-4">
        <div className="max-w-[700px]">
          <div className="text-[12px] font-semibold leading-[16px] tracking-[0.02em] text-white/72">
            3/3 결과 확인
          </div>
          <h2 className="mt-3 max-w-[14ch] text-[clamp(1.9rem,3.6vw,3rem)] font-[820] leading-[1.08] tracking-[-0.04em] text-white">
            {trip?.destination
              ? `${trip.destination} 일정이 준비됐어요`
              : '생성된 일정을 불러오고 있어요'}
          </h2>
          <p className="mt-3 max-w-[44rem] text-[clamp(0.98rem,1.55vw,1.1rem)] leading-[1.66] text-white/78">
            {trip
              ? `${tasteLabels.join(' · ') || '기본 취향'} 기준으로 읽기 쉬운 day 카드 구조를 만들었습니다. 이제 결과를 확인하고 필요하면 바로 재계획할 수 있습니다.`
              : '일정 정보를 정리하는 중입니다.'}
          </p>
        </div>
        <div className="grid gap-3 min-[360px]:grid-cols-3">
          <HeroStat
            label="여행 기간"
            value={trip ? formatDateRange(trip.startDate, trip.endDate) : '-'}
          />
          <HeroStat label="이동 방식" value={transportLabel(transportMode)} />
          <HeroStat label="재계획" value={`${replanCount}회`} />
        </div>
      </div>
    </section>
  );
}

function ProgressCard({ current, total }: { current: number; total: number }) {
  return (
    <SurfaceCard>
      <div className="flex items-center justify-between text-[13px] leading-[18px] text-[color:var(--text-secondary)]">
        <span>진행 단계</span>
        <span>
          {current}/{total}
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[rgba(15,23,42,0.08)]">
        <div
          className="h-full rounded-full bg-[color:var(--primary)] transition-all"
          style={{ width: `${(current / total) * 100}%` }}
        />
      </div>
    </SurfaceCard>
  );
}

function CompactSummaryCard({ title, description }: { title: string; description: string }) {
  return (
    <SurfaceCard>
      <div className="text-[12px] font-semibold leading-[16px] tracking-[0.02em] text-[color:var(--primary)]">
        {title}
      </div>
      <div className="mt-2 max-w-[24ch] text-[clamp(1.02rem,1.7vw,1.2rem)] font-semibold leading-[1.42] tracking-[-0.02em] text-[color:var(--text-primary)]">
        {description}
      </div>
    </SurfaceCard>
  );
}

function QuestionCard({
  title,
  description,
  options,
  selected,
  onToggle,
}: {
  title: string;
  description?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <SurfaceCard>
      <SectionTitle title={title} {...(description ? { description } : {})} />
      <div className="mt-5 flex flex-wrap gap-2.5">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(option.value)}
              className={`min-h-11 rounded-[14px] border px-3.5 py-3 text-[0.95rem] font-semibold leading-[1.2] transition ${
                active
                  ? 'border-[color:var(--line-strong)] bg-[color:var(--surface-blue)] text-[color:var(--primary-strong)] shadow-[0_10px_24px_rgba(49,130,246,0.12)]'
                  : 'border-[color:var(--line)] bg-white text-[color:var(--text-secondary)] hover:border-[color:var(--line-strong)] hover:bg-[color:var(--surface-muted)]'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </SurfaceCard>
  );
}

function DaySectionCard({
  day,
  items,
  changedItems,
}: {
  day: number;
  items: ItineraryItemDto[];
  changedItems: ChangedItem[];
}) {
  return (
    <SurfaceCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <StatusChip tone="brand">Day {day}</StatusChip>
          <div className="mt-3 max-w-[16ch] text-[clamp(1.2rem,4.5vw,1.45rem)] font-bold leading-[1.28] tracking-[-0.03em] text-[color:var(--text-primary)]">
            Day {day} 일정 요약
          </div>
          <p className="mt-2 max-w-[30rem] text-[15px] leading-[22px] text-[color:var(--text-secondary)]">
            시간, 장소, 이동 정보만 먼저 보이도록 요약했습니다.
          </p>
        </div>
        <StatusChip tone="muted">{items.length}개 일정</StatusChip>
      </div>

      <div className="mt-5 grid gap-3 min-[390px]:grid-cols-2">
        {items.map((item) => (
          <TimelineItem
            key={item.id}
            item={item}
            changed={changedItems.some((changed) => changed.after.id === item.id)}
          />
        ))}
      </div>
    </SurfaceCard>
  );
}

function TimelineItem({ item, changed }: { item: ItineraryItemDto; changed: boolean }) {
  return (
    <div
      className={`rounded-[16px] border px-4 py-4 shadow-[var(--shadow-md)] sm:px-5 ${
        changed
          ? 'border-[color:var(--line-strong)] bg-[color:var(--surface-blue)]'
          : 'border-[color:var(--line)] bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold leading-[16px] tracking-[0.02em] text-[color:var(--text-secondary)]">
            {formatTime(item.scheduledAt)} · {typeLabel(item.type)}
          </div>
          <div className="mt-2 max-w-[18ch] text-[clamp(1.05rem,1.7vw,1.2rem)] font-semibold leading-[1.35] tracking-[-0.02em] text-[color:var(--text-primary)]">
            {item.name}
          </div>
        </div>
        {changed ? <StatusChip tone="brand">변경됨</StatusChip> : null}
      </div>

      <div className="mt-4 grid gap-2 text-[14px] leading-[22px] text-[color:var(--text-secondary)]">
        <p className="rounded-[16px] bg-white/72 px-3 py-2">{item.address}</p>
        <p>
          예상 체류 {item.durationMin}분
          {item.travelTimeMin ? ` · 다음 장소 이동 ${item.travelTimeMin}분` : ''}
        </p>
        {item.memo ? (
          <p className="text-[color:var(--text-tertiary)]">{normalizeMemo(item.memo)}</p>
        ) : null}
      </div>
    </div>
  );
}

function ComparisonBlock({
  title,
  item,
  tone,
  emptyLabel,
}: {
  title: string;
  item: ItineraryItemDto | undefined;
  tone: 'muted' | 'active';
  emptyLabel: string;
}) {
  const toneClass =
    tone === 'active'
      ? 'border-[color:var(--line-strong)] bg-white'
      : 'border-[color:var(--line)] bg-[color:var(--surface-muted)]';

  return (
    <div className={`rounded-[20px] border p-4 ${toneClass}`}>
      <div className="text-[12px] font-semibold leading-[16px] text-[color:var(--text-tertiary)]">
        {title}
      </div>
      {item ? (
        <>
          <div className="mt-3 text-[17px] font-semibold leading-[24px] text-[color:var(--text-primary)]">
            {item.name}
          </div>
          <div className="mt-1 text-[13px] leading-[18px] text-[color:var(--text-secondary)]">
            {formatTime(item.scheduledAt)} · {item.address}
          </div>
          {item.memo ? (
            <div className="mt-2 text-[13px] leading-[19px] text-[color:var(--text-tertiary)]">
              {normalizeMemo(item.memo)}
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-3 text-[13px] leading-[18px] text-[color:var(--text-tertiary)]">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'date' | 'time' | 'number';
}) {
  return (
    <label className="block">
      <div className="mb-2 text-[13px] font-semibold leading-[18px] text-[color:var(--text-secondary)]">
        {label}
      </div>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-14 w-full rounded-[18px] border border-[color:var(--line)] bg-white px-4 text-[16px] font-medium leading-[24px] text-[color:var(--text-primary)] outline-none transition placeholder:text-[color:var(--text-quaternary)] focus:border-[color:var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(49,130,246,0.12)]"
      />
    </label>
  );
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h3 className="max-w-[20ch] text-[clamp(1.1rem,1.8vw,1.3rem)] font-semibold leading-[1.35] tracking-[-0.02em] text-[color:var(--text-primary)]">
        {title}
      </h3>
      {description ? (
        <p className="mt-2 max-w-[38rem] text-[15px] leading-[24px] text-[color:var(--text-secondary)]">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function PrimaryActionBar({
  helper,
  disabled,
  label,
  onClick,
  secondaryLabel,
  sticky = true,
}: {
  helper: string;
  disabled: boolean;
  label: string;
  onClick: () => void;
  secondaryLabel?: string;
  sticky?: boolean;
}) {
  return (
    <div
      className={
        sticky
          ? 'sticky bottom-0 z-20 -mx-4 border-t border-white/65 bg-[rgba(244,246,251,0.88)] px-4 pb-3 pt-4 backdrop-blur-xl sm:-mx-5 sm:px-5'
          : 'rounded-[20px] border border-[color:var(--line)] bg-white p-4 shadow-[var(--shadow-md)]'
      }
    >
      <div className="text-[13px] leading-[19px] text-[color:var(--text-secondary)]">{helper}</div>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`mt-3 h-14 w-full rounded-[18px] px-5 text-[clamp(0.98rem,1.4vw,1.05rem)] font-semibold leading-[24px] transition ${
          disabled
            ? 'bg-[rgba(148,163,184,0.24)] text-[rgba(100,116,139,0.72)]'
            : 'bg-[color:var(--primary)] text-white shadow-[0_12px_28px_rgba(29,78,216,0.24)] hover:translate-y-[-1px]'
        }`}
      >
        {label}
      </button>
      {secondaryLabel ? (
        <div className="mt-3 text-center text-[13px] leading-[18px] text-[color:var(--text-tertiary)]">
          {secondaryLabel}
        </div>
      ) : null}
    </div>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <SurfaceCard>
      <div className="flex items-center gap-3">
        <div className="size-10 animate-spin rounded-full border-4 border-[rgba(49,130,246,0.12)] border-t-[color:var(--primary)]" />
        <div>
          <div className="text-[18px] font-semibold leading-[26px] text-[color:var(--text-primary)]">
            로딩 중
          </div>
          <div className="mt-1 text-[15px] leading-[22px] text-[color:var(--text-secondary)]">
            {label}
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}

function StatusCard({
  actionLabel,
  tone,
  title,
  description,
  onAction,
}: {
  actionLabel?: string;
  tone: 'success' | 'error' | 'info';
  title: string;
  description: string;
  onAction?: () => void;
}) {
  const toneClass = {
    success:
      'border-[color:var(--success-line)] bg-[color:var(--success-bg)] text-[color:var(--success-text)]',
    error:
      'border-[color:var(--danger-line)] bg-[color:var(--danger-bg)] text-[color:var(--danger-text)]',
    info: 'border-[color:var(--info-line)] bg-[color:var(--info-bg)] text-[color:var(--info-text)]',
  }[tone];

  return (
    <div className={`rounded-[24px] border p-5 ${toneClass}`}>
      <div className="text-[18px] font-semibold leading-[26px]">{title}</div>
      <div className="mt-2 text-[15px] leading-[24px]">{description}</div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex min-h-11 items-center rounded-full border border-current px-4 py-2 text-[14px] font-semibold leading-[20px]"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <SurfaceCard>
      <div className="text-[18px] font-semibold leading-[26px] text-[color:var(--text-primary)]">
        {title}
      </div>
      <div className="mt-2 text-[15px] leading-[22px] text-[color:var(--text-secondary)]">
        {description}
      </div>
    </SurfaceCard>
  );
}

function QuickGuide({
  step,
  tasteLabels,
  transportMode,
}: {
  step: Step;
  tasteLabels: string[];
  transportMode: TransportMode;
}) {
  const stepCopy = {
    landing: '데모를 시작하면 취향 선택부터 일정 생성까지 순서대로 이어집니다.',
    taste: '먹거리, 분위기, 여행 환경을 고르면 일정 톤이 바로 정리됩니다.',
    trip: '여행 기간과 이동 방식을 입력하면 지금 조건에 맞는 일정을 만들어요.',
    result: '현재 일정과 재계획 기준을 한 번에 확인할 수 있어요.',
  }[step];

  return (
    <SurfaceCard>
      <SectionTitle title="현재 설정 요약" description={stepCopy} />
      <div className="mt-4 grid gap-3">
        <MetricTile label="현재 단계" value={labelForStep(step)} compact />
        <MetricTile label="선택한 취향" value={tasteLabels.join(' · ') || '기본 취향'} compact />
        <MetricTile label="이동 방식" value={transportLabel(transportMode)} compact />
      </div>
    </SurfaceCard>
  );
}

function SelectablePanel({
  active,
  label,
  helper,
  onClick,
}: {
  active: boolean;
  label: string;
  helper: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[16px] border px-4 py-4 text-left transition ${
        active
          ? 'border-[color:var(--line-strong)] bg-[color:var(--surface-blue)] text-[color:var(--primary-strong)] shadow-[0_12px_24px_rgba(49,130,246,0.12)]'
          : 'border-[color:var(--line)] bg-white text-[color:var(--text-secondary)] hover:border-[color:var(--line-strong)] hover:bg-[color:var(--surface-muted)]'
      }`}
    >
      <div className="text-[16px] font-semibold leading-[24px]">{label}</div>
      <div className="mt-1 text-[14px] leading-[21px] text-[color:var(--text-secondary)]">
        {helper}
      </div>
    </button>
  );
}

function SurfaceCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-[20px] border border-[color:var(--line)] bg-[color:var(--surface)] p-5 shadow-[var(--shadow-md)] ${className ?? ''}`}
    >
      {children}
    </section>
  );
}

function FeatureTile({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-4">
      <div className="text-[16px] font-semibold leading-[22px] text-[color:var(--text-primary)]">
        {title}
      </div>
      <div className="mt-2 text-[14px] leading-[22px] text-[color:var(--text-secondary)]">
        {description}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-[16px] border border-[color:var(--line)] bg-white ${compact ? 'p-4' : 'p-4 sm:p-5'}`}
    >
      <div className="text-[12px] font-semibold leading-[16px] text-[color:var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-2 text-[15px] font-semibold leading-[22px] text-[color:var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-white/18 bg-white/12 px-4 py-4">
      <div className="text-[12px] font-semibold leading-[16px] text-white/64">{label}</div>
      <div className="mt-2 text-[16px] font-semibold leading-[24px] text-white">{value}</div>
    </div>
  );
}

function StatusChip({ children, tone }: { children: ReactNode; tone: 'brand' | 'muted' }) {
  const toneClass =
    tone === 'brand'
      ? 'border-[color:var(--line-strong)] bg-[color:var(--surface-blue)] text-[color:var(--primary-strong)]'
      : 'border-[color:var(--line)] bg-white text-[color:var(--text-secondary)]';

  return (
    <span
      className={`inline-flex min-h-8 items-center rounded-full border px-3 py-1 text-[12px] font-semibold leading-[16px] ${toneClass}`}
    >
      {children}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-[color:var(--line)] bg-white px-4 py-3">
      <div className="text-[12px] font-semibold leading-[16px] text-[color:var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-1 text-[15px] font-medium leading-[22px] text-[color:var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}

function CalloutBox({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[18px] border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-4 py-4">
      <div className="text-[13px] font-semibold leading-[18px] text-[color:var(--text-primary)]">
        {title}
      </div>
      <div className="mt-2 text-[14px] leading-[22px] text-[color:var(--text-secondary)]">
        {description}
      </div>
    </div>
  );
}

function BulletRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[18px] border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-4 py-3">
      <span className="mt-[7px] size-2 rounded-full bg-[color:var(--primary)]" />
      <div className="text-[14px] leading-[22px] text-[color:var(--text-secondary)]">
        {children}
      </div>
    </div>
  );
}

function optionLabel(options: ReadonlyArray<{ value: string; label: string }>, value?: string) {
  return options.find((option) => option.value === value)?.label;
}

function slotKey(item: ItineraryItemDto) {
  return `${item.day}-${item.order}`;
}

function toggleSelection(
  setter: Dispatch<SetStateAction<TasteState>>,
  key: keyof TasteState,
  value: string,
) {
  setter((current) => {
    const active = current[key].includes(value);
    return {
      ...current,
      [key]: active ? current[key].filter((item) => item !== value) : [...current[key], value],
    };
  });
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function labelForStep(step: Step) {
  switch (step) {
    case 'landing':
      return '소개';
    case 'taste':
      return '취향';
    case 'trip':
      return '조건';
    case 'result':
      return '결과';
  }
}

function transportLabel(mode: TransportMode) {
  switch (mode) {
    case 'walk':
      return '도보 중심';
    case 'transit':
      return '대중교통';
    case 'car':
      return '차량 이동';
  }
}

function typeLabel(type: ItineraryItemDto['type']) {
  switch (type) {
    case 'attraction':
      return '장소';
    case 'restaurant':
      return '식사';
    case 'cafe':
      return '카페';
    case 'accommodation':
      return '숙소';
    case 'transport':
      return '이동';
  }
}

function normalizeMemo(memo: string) {
  return memo.replace(/waiting/gi, '대기 대응').replace(/manual/gi, '재조정');
}

function formatTime(iso: string) {
  const date = new Date(iso);
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  });
}

function formatDateRange(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

async function waitForUpdatedItinerary({
  accessToken,
  tripId,
  baseline,
}: {
  accessToken: string;
  tripId: string;
  baseline: ItineraryItemDto[];
}) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await api.get<ItineraryItemDto[]>(`/trips/${tripId}/itinerary`, accessToken);
    if (!sameItinerary(baseline, current) || attempt === 5) {
      return current;
    }
    await delay(1200);
  }
  return baseline;
}

function sameItinerary(left: ItineraryItemDto[], right: ItineraryItemDto[]) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => {
    const other = right[index];
    if (!other) {
      return false;
    }
    return (
      item.id === other.id &&
      item.name === other.name &&
      item.scheduledAt === other.scheduledAt &&
      item.memo === other.memo &&
      item.travelTimeMin === other.travelTimeMin
    );
  });
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
