"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type {
  ItineraryItemDto,
  LoginResponseDto,
  ReplanJobDto,
  ReplanResultDto,
  TripDto,
} from "@tripick/types";

import { api } from "../lib/api";
import { disconnect, joinTrip, onReplanResult } from "../lib/socket";

type Step = "landing" | "taste" | "trip" | "result";
type TransportMode = "walk" | "transit" | "car";
type ReplanMode = "manual" | "waiting";
type RetryAction = "demo-start" | "save-taste" | "create-trip" | "replan" | null;

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
  { value: "korean", label: "한식 중심" },
  { value: "japanese", label: "일식 취향" },
  { value: "western", label: "양식도 좋아요" },
  { value: "cafe", label: "카페는 꼭" },
  { value: "vegan", label: "가벼운 식사 선호" },
  { value: "chinese", label: "중식도 괜찮아요" },
] as const;

const MOOD_OPTIONS = [
  { value: "healing", label: "천천히 힐링" },
  { value: "adventure", label: "움직임 많은 일정" },
  { value: "romantic", label: "감도 있는 데이트" },
  { value: "family", label: "부담 적은 동선" },
  { value: "cultural", label: "전시·로컬 탐방" },
] as const;

const ENVIRONMENT_OPTIONS = [
  { value: "city", label: "도시 중심" },
  { value: "nature", label: "자연 위주" },
  { value: "beach", label: "바다 가까이" },
  { value: "mountain", label: "산·숲 선호" },
  { value: "village", label: "골목과 로컬" },
] as const;

const TRANSPORT_OPTIONS: Array<{ value: TransportMode; label: string; helper: string }> = [
  { value: "transit", label: "대중교통", helper: "도시 이동을 무난하게 연결해요" },
  { value: "walk", label: "도보 중심", helper: "가까운 동선 위주로 짜드려요" },
  { value: "car", label: "차량 이동", helper: "넓게 이동하는 일정에 맞춰요" },
];

const REPLAN_OPTIONS: Array<{ value: ReplanMode; label: string; helper: string }> = [
  { value: "manual", label: "분위기만 다시 조정", helper: "지금 톤을 유지하면서 동선을 새로 정리해요" },
  { value: "waiting", label: "웨이팅이 길어요", helper: "대기 시간을 반영해서 앞 순서를 다시 바꿔요" },
];

const INITIAL_TASTE: TasteState = {
  food: ["korean", "cafe"],
  mood: ["healing"],
  environment: ["city"],
};

const INITIAL_TRIP: TripFormState = {
  title: "부산 1박 2일 감도 여행",
  destination: "부산",
  startDate: "2026-05-10",
  endDate: "2026-05-11",
  wakeTime: "08:30",
  sleepTime: "22:30",
  transportMode: "transit",
};

const INITIAL_REPLAN: ReplanState = {
  trigger: "waiting",
  waitingMinutes: "20",
  note: "카페 웨이팅이 길어져서 주변 일정부터 보고 싶어요.",
};

export default function HomePage() {
  const [step, setStep] = useState<Step>("landing");
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

  const canSubmitTaste = taste.food.length > 0 && taste.mood.length > 0 && taste.environment.length > 0;
  const canSubmitTrip =
    tripForm.title.trim().length > 0 &&
    tripForm.destination.trim().length > 0 &&
    tripForm.startDate.length > 0 &&
    tripForm.endDate.length > 0 &&
    tripForm.wakeTime < tripForm.sleepTime &&
    tripForm.startDate <= tripForm.endDate;
  const canSubmitReplan = replan.trigger === "manual" || Number(replan.waitingMinutes) > 0;
  const selectedTasteSummary = [taste.food[0], taste.mood[0], taste.environment[0]].filter(Boolean).join(" · ");

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
        if (before.name !== item.name || before.scheduledAt !== item.scheduledAt || before.memo !== item.memo) {
          return { before, after: item };
        }
        return null;
      })
      .filter((item): item is ChangedItem => item !== null);
  }, [itinerary, previousItinerary]);

  async function handleDemoStart() {
    setRetryAction("demo-start");
    setLoadingLabel("데모 세션을 준비하고 있어요");
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const sessionResponse = await api.post<LoginResponseDto>("/auth/demo", {
        nickname: "tripick-demo",
      });
      setSession(sessionResponse);
      setStep("taste");
      setStatusMessage("데모 세션이 준비됐어요. 취향만 고르면 바로 일정 생성까지 이어집니다.");
      setRetryAction(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "데모 세션을 준비하지 못했습니다."));
    } finally {
      setLoadingLabel(null);
    }
  }

  async function handleSaveTaste() {
    if (!session || !canSubmitTaste) {
      return;
    }

    setRetryAction("save-taste");
    setLoadingLabel("취향을 저장하고 있어요");
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await api.put("/preferences", {
        tasteTags: {
          food: taste.food,
          mood: taste.mood,
          environment: taste.environment,
          confidence: 0.92,
        },
      }, session.tokens.accessToken);
      setStep("trip");
      setStatusMessage("취향이 저장됐어요. 이제 여행 조건만 입력하면 일정을 만들 수 있습니다.");
      setRetryAction(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "취향 저장에 실패했습니다."));
    } finally {
      setLoadingLabel(null);
    }
  }

  async function handleCreateTrip() {
    if (!session || !canSubmitTrip) {
      return;
    }

    setRetryAction("create-trip");
    setLoadingLabel("취향을 반영해 일정을 정리하고 있어요");
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const createdTrip = await api.post<TripDto>("/trips", tripForm, session.tokens.accessToken);
      const items = await api.get<ItineraryItemDto[]>(`/trips/${createdTrip.id}/itinerary`, session.tokens.accessToken);
      attachRealtime(createdTrip.id);
      setTrip(createdTrip);
      setItinerary(items);
      setPreviousItinerary([]);
      setReplanResult(null);
      setReplanCount(0);
      setStep("result");
      setStatusMessage("일정이 준비됐어요. 결과를 확인하고 바로 재계획도 테스트할 수 있습니다.");
      setRetryAction(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "일정 생성에 실패했습니다."));
    } finally {
      setLoadingLabel(null);
    }
  }

  async function handleReplan() {
    if (!session || !trip || !canSubmitReplan) {
      return;
    }

    setRetryAction("replan");
    setLoadingLabel(replan.trigger === "waiting" ? "웨이팅을 반영해 다시 짜고 있어요" : "일정 톤을 다시 정리하고 있어요");
    setErrorMessage(null);
    setStatusMessage(null);
    setPreviousItinerary(itinerary);
    setReplanResult(null);

    try {
      const body = {
        tripId: trip.id,
        trigger: replan.trigger,
        waitingMinutes: replan.trigger === "waiting" ? Number(replan.waitingMinutes) : undefined,
        context: replan.note.trim() ? { note: replan.note.trim() } : undefined,
      };

      if (replan.trigger === "waiting") {
        await api.post("/alternative/waiting", body, session.tokens.accessToken);
      } else {
        await api.post<ReplanResultDto | ReplanJobDto>("/replanning", body, session.tokens.accessToken);
      }

      const refreshed = await waitForUpdatedItinerary({
        accessToken: session.tokens.accessToken,
        tripId: trip.id,
        baseline: itinerary,
      });

      setItinerary(refreshed);
      setReplanCount((count) => count + 1);
      setStatusMessage(replan.trigger === "waiting" ? "웨이팅 기준으로 새 동선을 반영했어요." : "새로운 일정 톤으로 다시 정리했어요.");
      setRetryAction(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "재계획 요청에 실패했습니다."));
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
      setStatusMessage(result.explanation ?? "실시간 재계획 결과가 도착했어요.");
      setLoadingLabel(null);
      setRetryAction(null);
    });
  }

  function handleRetry() {
    switch (retryAction) {
      case "demo-start":
        void handleDemoStart();
        break;
      case "save-taste":
        void handleSaveTaste();
        break;
      case "create-trip":
        void handleCreateTrip();
        break;
      case "replan":
        void handleReplan();
        break;
      default:
        break;
    }
  }

  return (
    <main className="min-h-screen bg-[#F7F8FA] text-[#191F28]">
      <div className="mx-auto flex min-h-screen max-w-[480px] flex-col px-5 pb-8 pt-6">
        <Header step={step} session={session} />

        <div className="mt-6 flex flex-1 flex-col gap-6">
          {step === "landing" ? (
            <LandingSection onStart={handleDemoStart} loading={loadingLabel !== null} />
          ) : null}

          {step === "taste" ? (
            <>
              <TopContext
                eyebrow="1/3 취향 입력"
                title="질문 몇 개로 여행 톤을 먼저 맞춰볼게요"
                description="음식, 분위기, 환경 세 축만 고르면 일정 추천의 방향이 바로 정리됩니다."
              />
              <ProgressBar current={1} total={3} />
              <SelectionSummaryCard title="현재 선택한 여행 톤" description={selectedTasteSummary || "아직 선택 전"} />
              <QuestionCard
                title="음식 취향"
                description="가장 기대하는 식사 톤을 골라주세요"
                options={FOOD_OPTIONS}
                selected={taste.food}
                onToggle={(value) => toggleSelection(setTaste, "food", value)}
              />
              <QuestionCard
                title="여행 분위기"
                description="일정을 어떤 리듬으로 보내고 싶은지 선택해주세요"
                options={MOOD_OPTIONS}
                selected={taste.mood}
                onToggle={(value) => toggleSelection(setTaste, "mood", value)}
              />
              <QuestionCard
                title="선호 환경"
                description="주로 머무르고 싶은 공간을 고르면 돼요"
                options={ENVIRONMENT_OPTIONS}
                selected={taste.environment}
                onToggle={(value) => toggleSelection(setTaste, "environment", value)}
              />
              <StickyCta
                helper={canSubmitTaste ? "세 축이 모두 선택돼서 다음 단계로 넘어갈 수 있어요." : "음식·분위기·환경을 각각 하나 이상 선택해주세요."}
                disabled={!canSubmitTaste || loadingLabel !== null}
                label="여행 조건 입력으로 이동"
                onClick={handleSaveTaste}
              />
            </>
          ) : null}

          {step === "trip" ? (
            <>
              <TopContext
                eyebrow="2/3 여행 조건 입력"
                title="일정에 필요한 핵심 조건만 입력해주세요"
                description="목적지, 날짜, 생활 리듬, 이동 방식만 정하면 바로 day 카드 결과를 만듭니다."
              />
              <ProgressBar current={2} total={3} />
              <SelectionSummaryCard
                title="이번 추천 기준"
                description={`${selectedTasteSummary || "기본 취향"} · ${transportLabel(tripForm.transportMode)}`}
              />
              <Card>
                <div className="space-y-4">
                  <InputField
                    label="여행 이름"
                    value={tripForm.title}
                    onChange={(value) => setTripForm((current) => ({ ...current, title: value }))}
                    placeholder="예: 부산 1박 2일 감도 여행"
                  />
                  <InputField
                    label="목적지"
                    value={tripForm.destination}
                    onChange={(value) => setTripForm((current) => ({ ...current, destination: value }))}
                    placeholder="예: 부산"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <InputField
                      label="시작일"
                      type="date"
                      value={tripForm.startDate}
                      onChange={(value) => setTripForm((current) => ({ ...current, startDate: value }))}
                    />
                    <InputField
                      label="종료일"
                      type="date"
                      value={tripForm.endDate}
                      onChange={(value) => setTripForm((current) => ({ ...current, endDate: value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField
                      label="기상 시간"
                      type="time"
                      value={tripForm.wakeTime}
                      onChange={(value) => setTripForm((current) => ({ ...current, wakeTime: value }))}
                    />
                    <InputField
                      label="취침 시간"
                      type="time"
                      value={tripForm.sleepTime}
                      onChange={(value) => setTripForm((current) => ({ ...current, sleepTime: value }))}
                    />
                  </div>
                </div>
              </Card>

              <Card>
                <SectionTitle title="이동 방식" description="v1에서는 한 가지 이동 수단만 기준으로 잡습니다." />
                <div className="mt-4 grid gap-3">
                  {TRANSPORT_OPTIONS.map((option) => {
                    const active = tripForm.transportMode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setTripForm((current) => ({ ...current, transportMode: option.value }))}
                        className={`rounded-2xl border px-4 py-3 text-left transition ${
                          active
                            ? "border-[#3182F6] bg-[#EAF2FF] text-[#1B64DA]"
                            : "border-[#E5E8EB] bg-white text-[#4E5968]"
                        }`}
                      >
                        <div className="text-[15px] font-semibold leading-[22px]">{option.label}</div>
                        <div className="mt-1 text-[13px] leading-[18px] text-[#6B7684]">{option.helper}</div>
                      </button>
                    );
                  })}
                </div>
              </Card>

              <StickyCta
                helper={
                  canSubmitTrip
                    ? "목적지와 날짜, 생활 리듬이 모두 정리됐어요."
                    : "여행 이름/목적지/날짜를 입력하고 기상 시간이 취침 시간보다 이르게 맞춰주세요."
                }
                disabled={!canSubmitTrip || loadingLabel !== null}
                label="일정 만들기"
                onClick={handleCreateTrip}
              />
            </>
          ) : null}

          {step === "result" ? (
            <>
              <TopContext
                eyebrow="3/3 결과 확인"
                title={trip?.title ?? "생성된 일정"}
                description={trip ? `${trip.destination} · ${formatDateRange(trip.startDate, trip.endDate)} · ${transportLabel(tripForm.transportMode)}` : "일정을 불러오고 있어요"}
              />

              {trip ? (
                <SummaryCard trip={trip} taste={taste} replanCount={replanCount} />
              ) : null}

              <SelectionSummaryCard
                title="현재 재계획 포인트"
                description={
                  replan.trigger === "waiting"
                    ? `웨이팅 ${replan.waitingMinutes || "0"}분 기준으로 순서를 다시 정리합니다.`
                    : "현재 여행 톤을 유지하면서 다른 구성을 다시 제안합니다."
                }
              />

              {groupedDays.length > 0 ? (
                groupedDays.map(([day, items]) => (
                  <Card key={day}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[20px] font-bold leading-[28px] text-[#191F28]">Day {day}</div>
                        <div className="mt-1 text-[13px] leading-[18px] text-[#6B7684]">장소 · 시간 · 이동 정보 순서로 읽기 쉽게 정리했어요</div>
                      </div>
                      <div className="rounded-full bg-[#F2F4F6] px-3 py-1 text-[12px] font-semibold leading-[16px] text-[#4E5968]">
                        {items.length}개 일정
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {items.map((item) => (
                        <TimelineItem key={item.id} item={item} changed={changedItems.some((changed) => changed.after.id === item.id)} />
                      ))}
                    </div>
                  </Card>
                ))
              ) : (
                <EmptyState
                  title="아직 불러온 일정이 없어요"
                  description="일정 생성이 끝나면 day 카드와 타임라인이 이 영역에 표시됩니다."
                />
              )}

              <Card>
                <SectionTitle title="재계획 요청" description="manual 또는 waiting 기준으로 데모 재계획 흐름을 바로 확인할 수 있어요." />
                <div className="mt-4 grid gap-3">
                  {REPLAN_OPTIONS.map((option) => {
                    const active = replan.trigger === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setReplan((current) => ({ ...current, trigger: option.value }))}
                        className={`rounded-2xl border px-4 py-3 text-left transition ${
                          active
                            ? "border-[#3182F6] bg-[#EAF2FF] text-[#1B64DA]"
                            : "border-[#E5E8EB] bg-white text-[#4E5968]"
                        }`}
                      >
                        <div className="text-[15px] font-semibold leading-[22px]">{option.label}</div>
                        <div className="mt-1 text-[13px] leading-[18px] text-[#6B7684]">{option.helper}</div>
                      </button>
                    );
                  })}
                </div>

                {replan.trigger === "waiting" ? (
                  <div className="mt-4">
                    <InputField
                      label="예상 대기 시간(분)"
                      type="number"
                      value={replan.waitingMinutes}
                      onChange={(value) => setReplan((current) => ({ ...current, waitingMinutes: value }))}
                      placeholder="20"
                    />
                  </div>
                ) : null}

                <div className="mt-4">
                  <InputField
                    label="추가 메모"
                    value={replan.note}
                    onChange={(value) => setReplan((current) => ({ ...current, note: value }))}
                    placeholder="예: 웨이팅이 길어져서 산책 가능한 장소를 먼저 가고 싶어요"
                  />
                </div>

                <div className="mt-4 rounded-2xl border border-[#E5E8EB] bg-[#FAFBFC] p-4">
                  <div className="text-[13px] font-semibold leading-[18px] text-[#4E5968]">재계획 후 기대되는 변화</div>
                  <div className="mt-2 text-[15px] leading-[22px] text-[#6B7684]">
                    기존 일정과 달라진 항목을 별도 카드로 보여주고, 다시 보기 CTA 없이도 바로 비교할 수 있게 유지합니다.
                  </div>
                </div>
              </Card>

              <StickyCta
                helper={
                  canSubmitReplan
                    ? replan.trigger === "waiting"
                      ? "웨이팅 시간을 반영해 일정 순서를 다시 계산합니다."
                      : "현재 일정의 톤을 유지하며 새 구성을 요청합니다."
                    : "웨이팅 재계획은 대기 시간을 1분 이상 입력해야 합니다."
                }
                disabled={!canSubmitReplan || loadingLabel !== null}
                label={replan.trigger === "waiting" ? "웨이팅 기준으로 다시 짜기" : "지금 일정 다시 정리하기"}
                onClick={handleReplan}
              />

              {changedItems.length > 0 ? (
                <Card>
                  <SectionTitle title="재계획 후 달라진 일정" description="무엇이 바뀌었는지 바로 읽히도록 이전 일정과 나란히 정리했습니다." />
                  <div className="mt-4 space-y-3">
                    {changedItems.map((changed) => (
                      <div key={changed.after.id} className="rounded-2xl border border-[#E5E8EB] bg-[#FAFBFC] p-4">
                        <div className="text-[12px] font-semibold leading-[16px] text-[#3182F6]">Day {changed.after.day} · {formatTime(changed.after.scheduledAt)}</div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <ComparisonBlock title="이전" item={changed.before} tone="muted" emptyLabel="기존 항목 없음" />
                          <ComparisonBlock title="변경 후" item={changed.after} tone="active" emptyLabel="변경 항목 없음" />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}
            </>
          ) : null}

          {loadingLabel ? <LoadingCard label={loadingLabel} /> : null}
          {statusMessage ? <StatusCard tone="success" title="진행 상태" description={statusMessage} /> : null}
          {replanResult?.explanation ? <StatusCard tone="info" title="재계획 설명" description={replanResult.explanation} /> : null}
          {errorMessage ? (
            <StatusCard
              {...(retryAction ? { actionLabel: "같은 조건으로 다시 시도", onAction: handleRetry } : {})}
              description={errorMessage}
              tone="error"
              title="다시 확인이 필요해요"
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function Header({ step, session }: { step: Step; session: LoginResponseDto | null }) {
  return (
    <header className="rounded-[20px] border border-[#E5E8EB] bg-white px-5 py-4 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[12px] font-semibold leading-[16px] tracking-[0.02em] text-[#3182F6]">TriPick v1 demo</div>
          <h1 className="mt-2 text-[24px] font-bold leading-[32px] text-[#191F28]">취향으로 골라주는 여행 플래너</h1>
        </div>
        <div className="rounded-full bg-[#F2F4F6] px-3 py-1 text-[12px] font-semibold leading-[16px] text-[#4E5968]">{labelForStep(step)}</div>
      </div>
      <div className="mt-3 text-[15px] leading-[22px] text-[#6B7684]">
        {session ? `${session.user.nickname} 님 데모 세션으로 진행 중` : "로그인 없이 바로 데모 플로우를 확인할 수 있어요"}
      </div>
    </header>
  );
}

function LandingSection({ loading, onStart }: { loading: boolean; onStart: () => void }) {
  return (
    <>
      <TopContext
        eyebrow="로그인 없이 바로 체험"
        title="취향만 고르면 여행 계획이 쉬워져요"
        description="질문 몇 개에 답하면 일정 초안을 만들고, 마음에 안 들면 바로 다시 추천받을 수 있어요."
      />
      <Card>
        <SectionTitle title="데모에서 바로 확인되는 핵심" description="복잡한 설명 대신 실제 제품 흐름에 가까운 4단계만 보여줍니다." />
        <div className="mt-4 flex flex-wrap gap-[10px]">
          {["취향 입력", "여행 조건", "day 카드 결과", "재계획 요청"].map((item) => (
            <span key={item} className="min-h-11 rounded-[14px] border border-[#D6DBE1] bg-white px-[14px] py-3 text-[15px] font-medium leading-[22px] text-[#4E5968]">
              {item}
            </span>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Metric label="진입 방식" value="데모 세션" />
          <Metric label="완료 흐름" value="입력→결과→재계획" />
        </div>
      </Card>
      <Card>
        <SectionTitle title="결과 미리보기" description="실제 결과 화면은 지도보다 읽기 쉬운 일정 카드 위계에 집중합니다." />
        <div className="mt-4 rounded-2xl border border-[#E5E8EB] bg-[#FAFBFC] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-semibold leading-[16px] text-[#3182F6]">Day 1 부산 감도 코스</div>
              <div className="mt-2 text-[18px] font-semibold leading-[26px] text-[#191F28]">광안리 산책부터 저녁 식사까지</div>
            </div>
            <div className="rounded-full bg-white px-3 py-1 text-[12px] font-semibold leading-[16px] text-[#4E5968]">3개 일정</div>
          </div>
          <div className="mt-4 space-y-3">
            {[
              "10:00 광안리 산책 · 이동 부담 낮은 시작",
              "12:30 로컬 식당 · 취향 태그 반영",
              "15:00 카페 휴식 · 웨이팅 시 재계획 가능",
            ].map((item) => (
              <div key={item} className="rounded-2xl border border-[#E5E8EB] bg-white p-4 text-[15px] leading-[22px] text-[#4E5968]">
                {item}
              </div>
            ))}
          </div>
        </div>
      </Card>
      <StickyCta
        helper="지금은 로그인 없이 데모 세션으로 바로 체험할 수 있어요."
        disabled={loading}
        label="취향 입력하고 시작하기"
        onClick={onStart}
        secondaryLabel="실서비스 로그인 연동은 다음 단계에서 연결됩니다"
      />
    </>
  );
}

function TopContext({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <section>
      <div className="text-[12px] font-semibold leading-[16px] tracking-[0.02em] text-[#3182F6]">{eyebrow}</div>
      <h2 className="mt-2 text-[28px] font-bold leading-[34px] text-[#191F28]">{title}</h2>
      <p className="mt-2 text-[15px] leading-[22px] text-[#6B7684]">{description}</p>
    </section>
  );
}

function SelectionSummaryCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[20px] border border-[#E5E8EB] bg-white p-5 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
      <div className="text-[12px] font-semibold leading-[16px] tracking-[0.02em] text-[#3182F6]">{title}</div>
      <div className="mt-2 text-[16px] font-semibold leading-[24px] text-[#191F28]">{description}</div>
    </div>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="rounded-[20px] border border-[#E5E8EB] bg-white p-5 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between text-[13px] leading-[18px] text-[#6B7684]">
        <span>진행 단계</span>
        <span>{current}/{total}</span>
      </div>
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#E5E8EB]">
        <div className="h-full rounded-full bg-[#3182F6] transition-all" style={{ width: `${(current / total) * 100}%` }} />
      </div>
    </div>
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
    <Card>
      <SectionTitle title={title} description={description} />
      <div className="mt-4 flex flex-wrap gap-[10px]">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(option.value)}
              className={`min-h-11 rounded-[14px] border px-[14px] py-3 text-[15px] font-medium leading-[22px] transition ${
                active
                  ? "border-[#3182F6] bg-[#EAF2FF] text-[#1B64DA]"
                  : "border-[#D6DBE1] bg-white text-[#4E5968]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function SummaryCard({ trip, taste, replanCount }: { trip: TripDto; taste: TasteState; replanCount: number }) {
  const tone = [taste.food[0], taste.mood[0], taste.environment[0]].filter(Boolean).join(" · ");

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold leading-[16px] tracking-[0.02em] text-[#3182F6]">생성 완료</div>
          <div className="mt-2 text-[20px] font-bold leading-[28px] text-[#191F28]">{trip.destination} 일정이 준비됐어요</div>
          <div className="mt-2 text-[15px] leading-[22px] text-[#6B7684]">{tone || "기본 취향 세팅"} 기준으로 읽기 쉬운 day 카드 구조를 만들었습니다.</div>
        </div>
        <div className="rounded-2xl bg-[#F2F4F6] px-3 py-2 text-right text-[12px] font-semibold leading-[16px] text-[#4E5968]">
          재계획 {replanCount}회
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Metric label="기간" value={formatDateRange(trip.startDate, trip.endDate)} />
        <Metric label="상태" value={trip.status} />
        <Metric label="도착지" value={trip.destination} />
      </div>
    </Card>
  );
}

function TimelineItem({ item, changed }: { item: ItineraryItemDto; changed: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${changed ? "border-[#3182F6] bg-[#EAF2FF]" : "border-[#E5E8EB] bg-[#FAFBFC]"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold leading-[16px] text-[#4E5968]">{formatTime(item.scheduledAt)} · {typeLabel(item.type)}</div>
          <div className="mt-1 text-[18px] font-semibold leading-[26px] text-[#191F28]">{item.name}</div>
        </div>
        {changed ? <span className="rounded-full bg-white px-3 py-1 text-[12px] font-semibold leading-[16px] text-[#1B64DA]">변경됨</span> : null}
      </div>
      <div className="mt-3 space-y-2 text-[15px] leading-[22px] text-[#4E5968]">
        <p>{item.address}</p>
        <p>예상 체류 {item.durationMin}분{item.travelTimeMin ? ` · 다음 장소 이동 ${item.travelTimeMin}분` : ""}</p>
        {item.memo ? <p className="text-[#6B7684]">{item.memo}</p> : null}
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
  tone: "muted" | "active";
  emptyLabel: string;
}) {
  const toneClass = tone === "active" ? "border-[#3182F6] bg-white" : "border-[#E5E8EB] bg-[#F7F8FA]";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-[12px] font-semibold leading-[16px] text-[#6B7684]">{title}</div>
      {item ? (
        <>
          <div className="mt-2 text-[16px] font-semibold leading-[24px] text-[#191F28]">{item.name}</div>
          <div className="mt-1 text-[13px] leading-[18px] text-[#6B7684]">{formatTime(item.scheduledAt)} · {item.address}</div>
          {item.memo ? <div className="mt-2 text-[13px] leading-[18px] text-[#8B95A1]">{item.memo}</div> : null}
        </>
      ) : (
        <div className="mt-2 text-[13px] leading-[18px] text-[#8B95A1]">{emptyLabel}</div>
      )}
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "date" | "time" | "number";
}) {
  return (
    <label className="block">
      <div className="mb-2 text-[13px] font-semibold leading-[18px] text-[#4E5968]">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-14 w-full rounded-2xl border border-[#D6DBE1] bg-white px-4 text-[16px] font-medium leading-[24px] text-[#191F28] outline-none transition placeholder:text-[#8B95A1] focus:border-[#3182F6] focus:shadow-[0_0_0_4px_rgba(49,130,246,0.12)]"
      />
    </label>
  );
}

function SectionTitle({ title, description }: { title: string; description: string | undefined }) {
  return (
    <div>
      <h3 className="text-[18px] font-semibold leading-[26px] text-[#191F28]">{title}</h3>
      {description ? <p className="mt-1 text-[15px] leading-[22px] text-[#6B7684]">{description}</p> : null}
    </div>
  );
}

function StickyCta({
  helper,
  disabled,
  label,
  onClick,
  secondaryLabel,
}: {
  helper: string;
  disabled: boolean;
  label: string;
  onClick: () => void;
  secondaryLabel?: string;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-auto border-t border-[#E5E8EB] bg-[#F7F8FA]/95 px-5 pb-2 pt-4 backdrop-blur-sm">
      <div className="mb-3 text-[13px] leading-[18px] text-[#6B7684]">{helper}</div>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`h-14 w-full rounded-[18px] px-5 text-[16px] font-semibold leading-[24px] transition ${
          disabled ? "bg-[#E5E8EB] text-[#B0B8C1]" : "bg-[#3182F6] text-white hover:bg-[#1B64DA]"
        }`}
      >
        {label}
      </button>
      {secondaryLabel ? <div className="mt-3 text-center text-[13px] leading-[18px] text-[#8B95A1]">{secondaryLabel}</div> : null}
    </div>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-full border-4 border-[#EAF2FF] border-t-[#3182F6] animate-spin" />
        <div>
          <div className="text-[18px] font-semibold leading-[26px] text-[#191F28]">로딩 중</div>
          <div className="mt-1 text-[15px] leading-[22px] text-[#6B7684]">{label}</div>
        </div>
      </div>
    </Card>
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
  tone: "success" | "error" | "info";
  title: string;
  description: string;
  onAction?: () => void;
}) {
  const toneClass = {
    success: "border-[#BCE9D6] bg-[#F1FBF6] text-[#0B6B45]",
    error: "border-[#FFD3D8] bg-[#FFF5F6] text-[#C53D4A]",
    info: "border-[#D7E7FF] bg-[#F5F9FF] text-[#1B64DA]",
  }[tone];

  return (
    <div className={`rounded-[20px] border p-5 ${toneClass}`}>
      <div className="text-[18px] font-semibold leading-[26px]">{title}</div>
      <div className="mt-2 text-[15px] leading-[22px]">{description}</div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex min-h-11 items-center rounded-[14px] border border-current px-4 py-2 text-[14px] font-semibold leading-[20px]"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <div className="text-[18px] font-semibold leading-[26px] text-[#191F28]">{title}</div>
      <div className="mt-2 text-[15px] leading-[22px] text-[#6B7684]">{description}</div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#E5E8EB] bg-[#FAFBFC] p-4">
      <div className="text-[12px] font-semibold leading-[16px] text-[#6B7684]">{label}</div>
      <div className="mt-2 text-[15px] font-semibold leading-[22px] text-[#191F28]">{value}</div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-[20px] border border-[#E5E8EB] bg-white p-5 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">{children}</section>;
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
    case "landing":
      return "소개";
    case "taste":
      return "취향";
    case "trip":
      return "조건";
    case "result":
      return "결과";
  }
}

function transportLabel(mode: TransportMode) {
  switch (mode) {
    case "walk":
      return "도보 중심";
    case "transit":
      return "대중교통";
    case "car":
      return "차량 이동";
  }
}

function typeLabel(type: ItineraryItemDto["type"]) {
  switch (type) {
    case "attraction":
      return "장소";
    case "restaurant":
      return "식사";
    case "cafe":
      return "카페";
    case "accommodation":
      return "숙소";
    case "transport":
      return "이동";
  }
}

function formatTime(iso: string) {
  const date = new Date(iso);
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
}

function formatDateRange(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const formatter = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });
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
