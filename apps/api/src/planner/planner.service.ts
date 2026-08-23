import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItineraryService } from '../itinerary/itinerary.service';
import type { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { PreferencesService } from '../preferences/preferences.service';
import { WeatherHelper } from './helpers/weather.helper';
import { RouteHelper } from './helpers/route.helper';
import { ScheduleConstraint } from './helpers/schedule.constraint';
import {
  defaultVisitDuration,
  distributeFallbackDurations,
  itemsFittingRemaining,
  minimumItemsPerDay,
  targetItemsPerDay,
} from './helpers/itinerary-density';
import { fillDaySlots } from './helpers/day-slot-planner';
import { ARRIVAL_RADIUS_M } from '../arrival-alert/arrival-alert.constants';
import { ConstraintEngine, type ValidationResult } from './constraint/constraint.engine';
import { PlannerAgentService } from './agent/planner-agent.service';
import type { PlannedCandidate } from './agent/planner-agent.service';
import { PlaceRetrievalService } from './retrieval/place-retrieval.service';
import { TripEntity } from '../trips/trip.entity';
import { TripDayEntity } from '../trips/trip-day.entity';
import {
  addDaysToIsoDate,
  countTripDays,
  getAwakeWindow,
  getKstMinutes,
  haversineMeters,
  minutesSinceWake,
  minutesToTime,
  toKstIsoDate,
} from '@tripick/utils';
import type {
  CreateItineraryItemDto,
  ItineraryItemDto,
  PlaceDto,
  ReplanBudget,
  ReplanPace,
  ReplanRequestDto,
  ReplanTrigger,
  TasteTagDto,
} from '@tripick/types';
import type { CandidatePlace, PoolCategoryQuota, RetrievalContext } from './retrieval/types';

/**
 * 일차 수에 맞춘 후보 풀 종류별 하한. 하루에 필요한 건 끼니 2 + 휴식(카페) 1 이고, 볼거리는
 * 카탈로그에 넘쳐 나므로 하한을 크게 잡을 이유가 없다(상한 쪽이 이미 볼거리를 밀어 준다).
 */
function dayCategoryQuota(dayCount: number): PoolCategoryQuota {
  const days = Math.max(1, dayCount);
  return { restaurant: days * 2, cafe: days, attraction: 2 };
}

const PACE_HINT: Record<ReplanPace, string> = {
  relaxed: '여유로운 일정(하루 일정 수를 줄이고 이동·대기 부담 최소화)',
  balanced: '균형 잡힌 일정',
  packed: '알찬 일정(하루에 더 많은 곳을 방문)',
};

const BUDGET_HINT: Record<ReplanBudget, string> = {
  thrifty: '가성비 위주(무료·저렴한 장소 선호)',
  normal: '보통 예산',
  premium: '프리미엄(고급 맛집·명소 선호)',
};

/**
 * 트리거별 memo 꼬리말. `Record<ReplanTrigger, …>` 라 ReplanTrigger 에 값이 늘면 여기서
 * 컴파일 에러로 잡힌다 — if 체인 시절엔 새 트리거의 memo 가 조용히 빈 채로 나갔다.
 */
const TRIGGER_MEMO_NOTE: Record<ReplanTrigger, string> = {
  manual: '수동 재계획 요청 반영',
  deviation: '이탈 상황에서 복귀 쉬운 순서로 재배치',
  weather: '날씨 이벤트를 고려해 실내/대체 가능 장소 우선',
  crowd: '혼잡 예상을 고려해 붐비지 않는 대체 장소·시간대 우선',
};

/**
 * 오늘을 다시 짤 때 "지금" 에 더하는 준비 여유(분). 첫 장소까지의 이동은 별도로 더하므로
 * 이 값은 "요청하고 일어나는 시간" 만 덮는다.
 */
const REPLAN_START_LEAD_MIN = 10;

/**
 * 하루 끝까지 이만큼도 안 남았으면 그 항목부터 뺀다(분). 15분짜리 관광지 방문은 일정이라기보다
 * 노이즈다. 앵커된 일차는 이 값까지 체류를 줄여서라도 담고, 보통 일차는 줄이지 않고 뺀다.
 */
const MIN_FITTING_VISIT_MIN = 45;

/**
 * 오늘 일차의 재계획 앵커.
 *
 * 하루가 이미 진행된 상태에서 다시 짜면 아침부터 채워선 안 된다 — 지난 시각에 일정이 박히고
 * 영업시간 판정도 아침 기준으로 돌아간다. 그래서 "지금 이후" 만 계획하고, 이미 끝난 항목은
 * 그대로 남긴다.
 */
interface DayAnchor {
  /** 이 일차 계획을 시작할 시각("HH:MM", KST) */
  startTime: string;
  /** 남은 활동 구간에 담을 항목 수 상한. 0 이면 이 일차는 아예 다시 짜지 않는다. */
  maxItems: number;
  /** 그대로 남길 기존 항목 — 이미 끝난 것 + 지금 방문 중인 것(order 오름차순) */
  doneItems: ItineraryItemEntity[];
}

interface GenerateOptions {
  trigger?: ReplanRequestDto['trigger'];
  currentLocation?: ReplanRequestDto['currentLocation'];
  /** 사용자 자유 텍스트 요청. 검색·프롬프트 notes 에 합쳐진다 */
  note?: string;
  /** 재계획할 일차(1-based). 생략하면 전체 일정을 다시 짠다 */
  targetDays?: number[];
  /** 반드시 포함할 장소들 (후보 상위에 시드 + 프롬프트 반영) */
  mustIncludePlaces?: ReplanRequestDto['mustIncludePlaces'];
  /** 구조화 재계획 옵션 (강도·회피·동선·예산) */
  preferences?: ReplanRequestDto['preferences'];
}

/** 초안 한 회차의 판정 결과. 하드 제약 위반과 "다 못 담음"을 나눠 들고 있다. */
interface DraftAttempt {
  validation: ValidationResult;
  /** 배치안 대비 하루 끝에 걸려 잘려 나간 항목 수. */
  shortfall: number;
  /** 그대로 저장해도 되는 안인지 (제약 통과 + 잘려 나간 항목 없음). */
  accepted: boolean;
}

interface DraftBuildContext {
  trip: TripEntity;
  dayCount: number;
  /** 이번 생성이 실제로 채우는 일차 목록(오름차순). 전체 생성이면 1..dayCount */
  planDays: number[];
  itemsPerDay: number;
  /** 오늘에 해당하는 일차의 시작 시각·개수 상한. 없는 일차는 기상 시각 + 하루 목표 개수. */
  anchorByDay: Map<number, DayAnchor>;
  wakeTime: string;
  sleepTime: string;
  tasteTags: TasteTagDto | undefined;
  options: GenerateOptions;
  weatherHint: string;
}

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(
    @InjectRepository(TripEntity)
    private readonly tripsRepo: Repository<TripEntity>,
    @InjectRepository(TripDayEntity)
    private readonly tripDaysRepo: Repository<TripDayEntity>,
    private readonly itineraryService: ItineraryService,
    private readonly preferencesService: PreferencesService,
    private readonly plannerAgent: PlannerAgentService,
    private readonly weatherHelper: WeatherHelper,
    private readonly routeHelper: RouteHelper,
    private readonly placeRetrieval: PlaceRetrievalService,
    private readonly scheduleConstraint: ScheduleConstraint,
    private readonly constraintEngine: ConstraintEngine,
  ) {}

  async generateItinerary(tripId: string): Promise<ItineraryItemDto[]> {
    const trip = await this.tripsRepo.findOneBy({ id: tripId });
    if (!trip) {
      throw new NotFoundException(`Trip ${tripId} not found`);
    }

    const items = await this.buildAndStoreItinerary(trip, {});
    trip.status = 'confirmed';
    await this.tripsRepo.save(trip);
    return items;
  }

  async replan(request: ReplanRequestDto): Promise<ItineraryItemDto[]> {
    const trip = await this.tripsRepo.findOneBy({ id: request.tripId });
    if (!trip) {
      throw new NotFoundException(`Trip ${request.tripId} not found`);
    }

    return this.buildAndStoreItinerary(trip, {
      trigger: request.trigger,
      ...(request.currentLocation !== undefined ? { currentLocation: request.currentLocation } : {}),
      ...(request.note !== undefined ? { note: request.note } : {}),
      ...(request.targetDays !== undefined ? { targetDays: request.targetDays } : {}),
      ...(request.mustIncludePlaces !== undefined
        ? { mustIncludePlaces: request.mustIncludePlaces }
        : {}),
      ...(request.preferences !== undefined ? { preferences: request.preferences } : {}),
    });
  }

  private async buildAndStoreItinerary(trip: TripEntity, options: GenerateOptions): Promise<ItineraryItemDto[]> {
    this.assertTripWindow(trip);
    const preference = await this.preferencesService.findByUser(trip.userId);
    const tasteTags = preference?.tasteTags;
    // 저장된 취향 벡터로 pgvector 검색을 개인화 (블렌딩 + 리랭킹)
    const preferenceVector = await this.preferencesService.getPreferenceVector(trip.userId);
    const dayCount = countTripDays(trip.startDate, trip.endDate);
    const wakeTime = trip.wakeTime ?? '08:30';
    const sleepTime = trip.sleepTime ?? '22:00';
    const pace = options.preferences?.pace ?? preference?.profile?.pace;
    // 강도별 3/4/5개는 최소 밀도다. 활동 시간이 길면 하루가 일찍 끝나지 않도록 늘린다.
    const minimumDailyItems = minimumItemsPerDay(pace);
    const itemsPerDay = targetItemsPerDay(pace, wakeTime, sleepTime);
    // 저장된 기존 항목. 사용자 memo 보존 + 유지되는 일차·이미 지난 항목 파악에 쓴다.
    const existingItems = await this.itineraryService.findByTrip(trip.id, trip.userId);
    // 이번에 다시 짤 일차. 부분 재계획이면 나머지 일차는 저장된 일정을 그대로 둔다.
    const requestedDays = this.resolvePlanDays(options.targetDays, dayCount);
    // 요청 일차 중 "오늘" 이 있으면 아침이 아니라 지금 이후만 다시 짠다.
    const anchorByDay = this.resolveDayAnchors({
      trip,
      planDays: requestedDays,
      wakeTime,
      sleepTime,
      existingItems,
      ...(options.currentLocation !== undefined ? { currentLocation: options.currentLocation } : {}),
      now: new Date(),
    });
    // 남은 활동 시간에 한 곳도 안 들어가는 일차는 건드리지 않는다 — 저장된 일정을 지우고
    // 아무것도 못 넣는 게 최악이라, 그 일차는 그대로 두고 나머지만 다시 짠다.
    const planDays = requestedDays.filter((day) => anchorByDay.get(day)?.maxItems !== 0);
    if (planDays.length === 0) {
      this.logger.log(
        `Skipped replan for trip ${trip.id} — 대상 일차(${requestedDays.join(',')})에 남은 활동 시간이 없음`,
      );
      return [...existingItems]
        .sort((a, b) => a.day - b.day || a.order - b.order)
        .map((item) => this.toItemDto(item));
    }
    const partial = planDays.length < dayCount;
    // 여행 고정 노트 + 재계획 요청 노트 + 구조화 옵션을 하나의 지시문으로 합쳐 검색·프롬프트에 반영
    const combinedNotes = this.buildCombinedNotes(trip.notes, options);
    // 검색 컨텍스트 중 지역(destination)·개수(limit) 외 공통 항목. 단일/일자별 두 경로가 공유한다.
    const sharedRetrieval = {
      userId: trip.userId,
      notes: combinedNotes,
      // 부분 재계획이면 여행 시작일이 아니라 다시 짜는 첫 일차 기준으로 영업시간·가용성을 본다.
      // 오늘을 다시 짜는 경우엔 기상 시각이 아니라 앵커(지금 이후)가 기준이다 — 아침 기준으로
      // 보면 저녁에만 문 여는 곳이 떨어지고 이미 닫은 곳이 살아남는다.
      startAt: this.makeDateTime(
        this.offsetDate(trip.startDate, planDays[0]! - 1),
        this.dayStartTime(anchorByDay, planDays[0]!, wakeTime),
      ),
      // 기간 있는 행사(축제)를 여행 날짜와 겹칠 때만 후보로 남기기 위한 날짜 구간.
      // 끝이 다시 짜는 **마지막** 일차여야 한다 — 시작일만 보면 3일차에 열리는 축제가 통째로 빠진다.
      // (일자별 경로는 아래에서 그 날 하루로 좁혀 덮어쓴다.)
      visitWindow: {
        from: this.offsetDate(trip.startDate, planDays[0]! - 1),
        to: this.offsetDate(trip.startDate, planDays[planDays.length - 1]! - 1),
      },
      ...(tasteTags !== undefined ? { tasteTags } : {}),
      ...(preferenceVector ? { preferenceVector } : {}),
      ...(options.trigger !== undefined ? { trigger: options.trigger } : {}),
      ...(options.currentLocation !== undefined ? { currentLocation: options.currentLocation } : {}),
    } satisfies Omit<RetrievalContext, 'destination' | 'limit'>;

    // 반드시 포함할 장소는 최상위 후보로 시드해 배치 우선순위를 높인다
    const mustCandidates = this.buildMustIncludeCandidates(options.mustIncludePlaces);
    // 부분 재계획에서 다시 짜지 않는 일차의 항목들 — 그대로 남기고 중복 배치도 막는다.
    const keptItems = partial ? existingItems.filter((item) => !planDays.includes(item.day)) : [];
    // 오늘 일차에서 이미 끝난(또는 방문 중인) 항목. 그대로 남기므로 후보에서도 빼야
    // 같은 장소가 오늘 두 번 배치되지 않는다.
    const doneItems = planDays.flatMap((day) => anchorByDay.get(day)?.doneItems ?? []);
    const untouchedItems = [...keptItems, ...doneItems];
    // 일자별 지역 매핑(trip_days). 미설정이면 모든 날 = trip.destination 으로 채워진다.
    const dayRegions = await this.resolveDayRegions(trip, dayCount);
    // 서로 다른 지역이 2개 이상이면 일자별 경로, 아니면 기존 단일 풀 + AI 플래너 경로.
    // 판정은 여행 전체 기준이다 — 한 일차만 다시 짜도 그 일차의 지역으로만 채워야 하므로,
    // 부분 재계획이라고 단일 풀(결합 라벨 destination) 경로로 떨어뜨리면 안 된다.
    const perDayMode = new Set(dayRegions.flat()).size > 1;

    let candidates: CandidatePlace[];
    let poolsByDay: CandidatePlace[][] | null = null;
    let traceLabel: string;
    if (perDayMode) {
      // 다시 짜는 일차의 지역만 조회한다(index 는 planDays 와 1:1).
      const planDayRegions = planDays.map((day) => dayRegions[day - 1] ?? [trip.destination]);
      // 일차별 날짜를 함께 넘겨 그 날 열리는 행사만 그 일차 후보로 들어가게 한다.
      const planDayDates = planDays.map((day) => this.offsetDate(trip.startDate, day - 1));
      poolsByDay = (
        await this.retrievePerDay(planDayRegions, sharedRetrieval, itemsPerDay, planDayDates)
      ).map((pool) => this.excludeKeptPlaces(pool, untouchedItems));
      candidates = [...mustCandidates, ...poolsByDay.flat()];
      traceLabel = `per-day[${planDayRegions.map((regions) => regions.join('/')).join(' | ')}]`;
    } else {
      // 앵커된 일차는 남은 시간만큼만 담으므로 일차별 목표를 합쳐 필요한 후보 수를 낸다.
      const totalTargetItems = planDays.reduce(
        (sum, day) => sum + this.dayItemTarget(anchorByDay, day, itemsPerDay),
        0,
      );
      const retrieval = await this.placeRetrieval.retrieve({
        ...sharedRetrieval,
        destination: trip.destination,
        limit: Math.max(totalTargetItems + 4, 12),
        // 다시 짜는 일차 수만큼 끼니·휴식 자리를 요구한다. 이게 없으면 풀에 식음이 2개만
        // 보장되고 그 2개도 거의 항상 음식점이라, 3일 여행에 카페가 한 번도 안 들어온다.
        categoryQuota: dayCategoryQuota(planDays.length),
      });
      candidates = [...mustCandidates, ...this.excludeKeptPlaces(retrieval.places, untouchedItems)];
      traceLabel = `${trip.destination} sources=${retrieval.trace.sources.join('+') || 'none'} avg=${retrieval.trace.averageConfidence.toFixed(2)}`;
    }

    if (candidates.length === 0) {
      throw new BadRequestException('No place candidates found for itinerary generation');
    }

    // 다시 짜는 일차의 실제 날짜. 프롬프트 day↔날짜 매핑과 날씨 힌트 범위가 이걸 공유한다.
    const planDates = planDays.map((day) => this.offsetDate(trip.startDate, day - 1));
    const firstCandidate = candidates[0];
    const forecast = firstCandidate
      ? await this.weatherHelper.getExtendedForecast(firstCandidate.coordinates.lat, firstCandidate.coordinates.lng)
      : new Map();
    // 예보맵 키는 기상청 포맷(YYYYMMDD)이라 하이픈을 뗀다. 대상 일차 예보만 힌트에 싣는다.
    const weatherHint = this.weatherHelper.buildWeatherHint(
      forecast,
      planDates.map((date) => date.replace(/-/g, '')),
    );
    // 단일 지역: AI 플래너가 하루 리듬·카테고리 균형을 맞춘다.
    // 일자별 지역: 각 일차를 그 날 지역 후보로만 채워야 하므로 지역-스코프 결정적 배치를 쓴다
    // (AI 는 여러 지역을 섞어 배치할 위험이 있어 일자별 모드에선 사용하지 않는다).
    // AI 플래너는 항상 1..N(=다시 짜는 일차 수)로 계획하고, 결과를 실제 일차 번호로 되돌린다.
    // 부분 재계획 때문에 프롬프트에 "3일차만" 같은 조건을 넣기보다 범위를 줄여 넘기는 쪽이
    // 후보 수·day 검증(1..dayCount)과도 어긋나지 않는다. 실제 날짜는 dayDates 로 함께 넘긴다 —
    // 시작·종료일 두 값은 [1,3] 같은 비연속 범위를 표현하지 못해 dayCount 와 어긋났다.
    const agentPlan = perDayMode
      ? this.buildPerDayDeterministicPlan(poolsByDay!, itemsPerDay, planDays, anchorByDay, wakeTime)
      : this.remapPlanDays(
          await this.plannerAgent.plan({
            destination: trip.destination,
            dayDates: planDates,
            // 앵커된 일차는 시작 시각·개수가 다르다. 안 넘기면 LLM 이 아침 리듬(브런치 카페 →
            // 점심 → 오후 명소)으로 하루를 짜고, 뒤에서 앞부터 잘라내므로 저녁 재계획에
            // 아침 슬롯이 남는다.
            dayStartTimes: planDays.map((day) => this.dayStartTime(anchorByDay, day, wakeTime)),
            dayItemTargets: planDays.map((day) => this.dayItemTarget(anchorByDay, day, itemsPerDay)),
            wakeTime,
            sleepTime,
            transportMode: trip.transportMode,
            dayCount: planDays.length,
            minimumItemsPerDay: minimumDailyItems,
            itemsPerDay,
            candidates,
            notes: combinedNotes,
            weatherHint,
            ...(tasteTags !== undefined ? { tasteTags } : {}),
            ...(options.trigger !== undefined ? { trigger: options.trigger } : {}),
          }),
          planDays,
        );

    const draftContext: DraftBuildContext = {
      trip,
      dayCount,
      planDays,
      itemsPerDay,
      anchorByDay,
      wakeTime,
      sleepTime,
      tasteTags,
      options,
      weatherHint,
    };
    // LLM 이 필수 포함 장소를 누락했으면 강제로 주입한다(시드+프롬프트는 best-effort 라 보장 안 됨).
    const guaranteedPlan = this.enforceMustInclude(agentPlan, mustCandidates, planDays, perDayMode);
    const aiAttempt = await this.evaluateDraft(guaranteedPlan, draftContext);
    // 검증 실패 시 근접 후보 우선 재정렬 기반 결정적 재생성. 모드에 맞는 배치 생성기를 넘긴다.
    const rebuildAttempts = perDayMode
      ? Math.min(3, Math.max(1, ...poolsByDay!.map((pool) => pool.length)))
      : Math.min(3, candidates.length);
    const planFactory = perDayMode
      ? (attempt: number) =>
          this.enforceMustInclude(
            this.buildPerDayDeterministicPlan(
              // 풀은 이미 그 일차 지역으로 좁혀져 있지만, 지역 안에서도 흩어질 수 있어 같은 기준으로 잇는다.
              poolsByDay!.map((pool, index) =>
                this.orderByProximity(pool, attempt, this.dayOrigin(draftContext, planDays[index]!)),
              ),
              itemsPerDay,
              planDays,
              anchorByDay,
              wakeTime,
            ),
            mustCandidates,
            planDays,
            true,
          )
      : (attempt: number) =>
          this.enforceMustInclude(
            this.buildDeterministicPlan(
              this.orderByProximity(candidates, attempt, this.dayOrigin(draftContext, planDays[0]!)),
              draftContext,
            ),
            mustCandidates,
            planDays,
          );
    const finalItems = aiAttempt.accepted
      ? aiAttempt.validation.items
      : await this.rebuildValidDraft(planFactory, draftContext, aiAttempt, rebuildAttempts);
    this.warnDayShortfall(finalItems, draftContext, candidates.length);

    // memo 는 사용자가 직접 남기는 메모 공간이므로 생성 단계의 AI 추론(취향·confidence·
    // 날씨 힌트)을 저장하지 않는다. 새 일정의 memo 는 비어 있는 채로 시작한다.
    // 단, 재계획으로 항목을 갈아끼울 때 같은 장소가 다시 배치되면 사용자가 남긴 기존 memo
    // (예약 시간·준비물 등)를 이어받는다. replaceTripItems 가 기존 항목을 전부 삭제하므로
    // 여기서 미리 보존하지 않으면 사용자 메모가 사라진다.
    const memoByPlace = this.indexMemosByPlace(existingItems);
    // 오늘 이미 끝난 항목은 새 일정 앞에 그대로 다시 넣는다 — 저장이 대상 일차를 통째로
    // 갈아끼우므로(replaceDayItems), 여기서 싣지 않으면 사용자가 오늘 다녀온 기록이 사라진다.
    // 새 항목의 order 는 남긴 개수만큼 뒤로 밀어 하루 순서가 이어지게 한다.
    const doneStoreItems = doneItems.map((item) => this.toStoreItem(item));
    const orderOffsetByDay = new Map(
      planDays.map((day) => [day, anchorByDay.get(day)?.doneItems.length ?? 0]),
    );
    const toStore: CreateItineraryItemDto[] = finalItems.map((item) => {
      const preservedMemo = memoByPlace.get(this.placeMemoKey(item));
      return {
        tripId: item.tripId,
        day: item.day,
        order: item.order + (orderOffsetByDay.get(item.day) ?? 0),
        type: item.type,
        name: item.name,
        address: item.address,
        coordinates: item.coordinates,
        scheduledAt: item.scheduledAt,
        durationMin: item.durationMin,
        ...(item.travelTimeMin ? { travelTimeMin: item.travelTimeMin } : {}),
        ...(item.openingHours ? { openingHours: item.openingHours } : {}),
        ...(item.phoneNumber ? { phoneNumber: item.phoneNumber } : {}),
        ...(item.kakaoPlaceId ? { kakaoPlaceId: item.kakaoPlaceId } : {}),
        ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
        ...(preservedMemo ? { memo: preservedMemo } : {}),
      } as CreateItineraryItemDto;
    });

    const storePayload = [...doneStoreItems, ...toStore].sort(
      (a, b) => a.day - b.day || a.order - b.order,
    );
    // 부분 재계획은 대상 일차만 갈아끼운다. 전체 재계획은 기존대로 통째로 교체.
    const saved = partial
      ? await this.itineraryService.replaceDayItems(trip.id, planDays, storePayload)
      : await this.itineraryService.replaceTripItems(trip.id, storePayload);
    this.logger.log(
      `Generated ${saved.length} itinerary items for trip ${trip.id} (days ${planDays.join(',')}) using CRAG ${traceLabel}`,
    );
    // 유지한 일차 + 새로 저장한 일차를 합쳐 항상 여행 전체 일정을 돌려준다
    // (WS `updatedItems` 를 그대로 화면에 얹는 소비자가 남은 일차를 잃지 않도록).
    return [...keptItems, ...saved]
      .sort((a, b) => a.day - b.day || a.order - b.order)
      .map((item) => this.toItemDto(item));
  }

  /**
   * 요청 일차 중 "오늘"(KST)에 해당하는 일차의 재계획 앵커를 만든다. 오늘이 아닌 일차는
   * 지도에 넣지 않으며(= 기존대로 기상 시각부터 하루 전체), 기상 전이면 앵커 자체가 불필요하다.
   *
   * 시작 시각은 `지금 + 준비 여유`이고, 지금 방문 중인 항목이 있으면 그게 끝난 뒤로 미룬다.
   * 남은 활동 시간에 한 곳도 안 들어가면 `maxItems: 0` 으로 두어 호출자가 그 일차를
   * 아예 건드리지 않게 한다(저장된 일정을 지우고 빈 하루를 남기는 게 최악이다).
   */
  private resolveDayAnchors(params: {
    trip: TripEntity;
    planDays: number[];
    wakeTime: string;
    sleepTime: string;
    existingItems: ItineraryItemEntity[];
    currentLocation?: GenerateOptions['currentLocation'];
    now: Date;
  }): Map<number, DayAnchor> {
    const { trip, planDays, wakeTime, sleepTime, existingItems, currentLocation, now } = params;
    const anchors = new Map<number, DayAnchor>();
    const window = getAwakeWindow(wakeTime, sleepTime);
    const nowMinutes = getKstMinutes(now);
    // 기상 전이면 하루가 아직 시작되지 않았다 — 평소대로 아침부터 채운다.
    // (자정을 넘는 활동 구간에서도 벽시계 비교로 맞다: 취침 01:00 여행의 00:30 은 그 날
    //  기상 08:00 이전이므로 앵커 없이 하루 전체를 짜는 게 옳다.)
    if (nowMinutes <= window.wakeMinutes) return anchors;

    const todayIso = toKstIsoDate(now);
    for (const day of planDays) {
      if (this.offsetDate(trip.startDate, day - 1) !== todayIso) continue;

      const doneItems = this.resolveDoneItems(existingItems, day, now, currentLocation);
      // 방문 중인 항목이 있으면 그게 끝난 뒤부터, 없으면 지금 + 준비 여유부터 시작한다.
      const lastDoneEnd = doneItems.reduce((latest, item) => Math.max(latest, this.itemEndAt(item)), 0);
      const startAt = new Date(
        Math.max(now.getTime() + REPLAN_START_LEAD_MIN * 60_000, lastDoneEnd),
      );
      const startMinutes = getKstMinutes(startAt);
      const remainMin =
        window.lengthMinutes - minutesSinceWake(startMinutes, window.wakeMinutes);
      anchors.set(day, {
        startTime: minutesToTime(startMinutes),
        maxItems: remainMin > 0 ? itemsFittingRemaining(remainMin) : 0,
        doneItems,
      });
    }
    return anchors;
  }

  /**
   * 그 일차에서 다시 짜지 않고 남길 항목 — ① 이미 끝난 항목(방문 완료로 본다)
   * ② 지금 진행 중이면서 사용자가 그 좌표 근처에 있는 항목(방문 중).
   *
   * 진행 중인데 근처에 없으면 남기지 않는다 — 그게 바로 미도착 상황이고, 다시 짜 달라는 게
   * 이탈 재계획 요청 자체다. 위치를 모르면(현재 위치 없음) 같은 이유로 남기지 않는다.
   */
  private resolveDoneItems(
    items: ItineraryItemEntity[],
    day: number,
    now: Date,
    currentLocation?: GenerateOptions['currentLocation'],
  ): ItineraryItemEntity[] {
    return items
      .filter((item) => item.day === day)
      .filter((item) => {
        const startedAt = new Date(item.scheduledAt).getTime();
        if (startedAt >= now.getTime()) return false;
        if (this.itemEndAt(item) <= now.getTime()) return true;
        if (!currentLocation) return false;
        return haversineMeters(currentLocation, item.coordinates) <= ARRIVAL_RADIUS_M;
      })
      .sort((a, b) => a.order - b.order);
  }

  /** 항목이 끝나는 시각(epoch ms). */
  private itemEndAt(item: ItineraryItemEntity): number {
    return new Date(item.scheduledAt).getTime() + item.durationMin * 60_000;
  }

  /** 그 일차의 활동 구간이 끝나는 시각(epoch ms). 취침이 자정을 넘어도 구간 길이로 계산한다. */
  private dayEndAt(context: DraftBuildContext, day: number): number {
    const window = getAwakeWindow(context.wakeTime, context.sleepTime);
    const wakeAt = this.makeDateTime(
      this.offsetDate(context.trip.startDate, day - 1),
      context.wakeTime,
    );
    return wakeAt.getTime() + window.lengthMinutes * 60_000;
  }

  /** 그 일차 계획의 시작 시각. 앵커가 없으면 기상 시각. */
  private dayStartTime(
    anchorByDay: Map<number, DayAnchor>,
    day: number,
    wakeTime: string,
  ): string {
    return anchorByDay.get(day)?.startTime ?? wakeTime;
  }

  /** 그 일차에 담을 항목 수 상한. 앵커가 없으면 하루 목표 개수. */
  private dayItemTarget(
    anchorByDay: Map<number, DayAnchor>,
    day: number,
    itemsPerDay: number,
  ): number {
    return anchorByDay.get(day)?.maxItems ?? itemsPerDay;
  }

  /** 남길 기존 항목을 저장 payload 로 되돌린다(시각·체류·메모 그대로). */
  private toStoreItem(item: ItineraryItemEntity): CreateItineraryItemDto {
    return {
      tripId: item.tripId,
      day: item.day,
      order: item.order,
      type: item.type,
      name: item.name,
      address: item.address,
      coordinates: item.coordinates,
      scheduledAt: new Date(item.scheduledAt).toISOString(),
      durationMin: item.durationMin,
      ...(item.travelTimeMin ? { travelTimeMin: item.travelTimeMin } : {}),
      ...(item.openingHours ? { openingHours: item.openingHours } : {}),
      ...(item.phoneNumber ? { phoneNumber: item.phoneNumber } : {}),
      ...(item.kakaoPlaceId ? { kakaoPlaceId: item.kakaoPlaceId } : {}),
      ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
      ...(item.memo ? { memo: item.memo } : {}),
    } as CreateItineraryItemDto;
  }

  /** 저장된 일정 항목 엔티티를 응답 DTO 로 변환한다. */
  private toItemDto(item: ItineraryItemEntity): ItineraryItemDto {
    return {
      id: item.id,
      tripId: item.tripId,
      day: item.day,
      order: item.order,
      type: item.type,
      name: item.name,
      address: item.address,
      coordinates: item.coordinates,
      scheduledAt: item.scheduledAt.toISOString(),
      durationMin: item.durationMin,
      ...(item.travelTimeMin ? { travelTimeMin: item.travelTimeMin } : {}),
      ...(item.openingHours ? { openingHours: item.openingHours } : {}),
      ...(item.phoneNumber ? { phoneNumber: item.phoneNumber } : {}),
      ...(item.kakaoPlaceId ? { kakaoPlaceId: item.kakaoPlaceId } : {}),
      ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
      ...(item.memo ? { memo: item.memo } : {}),
    };
  }

  /**
   * 재계획 대상 일차를 여행 범위(1..dayCount)로 정규화한다. 중복·범위 밖 값을 걷어내고
   * 오름차순 정렬한다. 지정이 없거나 유효한 값이 하나도 없으면 전체 일차로 되돌린다
   * (요청이 잘못됐다고 아무 일도 안 하는 것보다 기존 동작인 전체 재계획이 안전하다).
   */
  private resolvePlanDays(targetDays: number[] | undefined, dayCount: number): number[] {
    const allDays = Array.from({ length: dayCount }, (_, index) => index + 1);
    if (!targetDays?.length) return allDays;
    const valid = [...new Set(targetDays)]
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= dayCount)
      .sort((a, b) => a - b);
    return valid.length > 0 ? valid : allDays;
  }

  /** AI 플래너가 1..N 으로 준 일차를 실제 일차 번호로 되돌린다. */
  private remapPlanDays(plan: PlannedCandidate[], planDays: number[]): PlannedCandidate[] {
    if (planDays.every((day, index) => day === index + 1)) return plan;
    return plan.map((planned) => ({
      ...planned,
      day: planDays[planned.day - 1] ?? planDays[planDays.length - 1]!,
    }));
  }

  /**
   * 다시 짜지 않는 일차에 이미 들어있는 장소를 후보에서 뺀다. 부분 재계획은 전체 계획을
   * 다시 만들지 않으므로, 걸러두지 않으면 같은 장소가 두 일차에 중복 배치된다.
   */
  private excludeKeptPlaces(
    candidates: CandidatePlace[],
    keptItems: ItineraryItemEntity[],
  ): CandidatePlace[] {
    if (keptItems.length === 0) return candidates;
    const keptKeys = new Set(keptItems.map((item) => this.placeMemoKey(item)));
    const keptNames = new Set(keptItems.map((item) => item.name.trim().toLowerCase()));
    return candidates.filter(
      (candidate) =>
        !keptKeys.has(this.placeMemoKey(candidate)) &&
        !keptNames.has(candidate.name.trim().toLowerCase()),
    );
  }

  private async buildDraft(
    plan: PlannedCandidate[],
    context: DraftBuildContext,
  ): Promise<ItineraryItemDto[]> {
    const { trip, planDays, itemsPerDay, anchorByDay, wakeTime, tasteTags, options, weatherHint } =
      context;
    const created: CreateItineraryItemDto[] = [];

    for (const day of planDays) {
      const startTime = this.dayStartTime(anchorByDay, day, wakeTime);
      const dayPlan = plan
        .filter((item) => item.day === day)
        .sort((a, b) => a.order - b.order)
        .slice(0, this.dayItemTarget(anchorByDay, day, itemsPerDay));
      let currentAt = this.makeDateTime(this.offsetDate(trip.startDate, day - 1), startTime);
      const anchored = anchorByDay.has(day);
      // 하루의 끝(취침)은 **앵커 유무와 무관하게** 경계다.
      //
      // 예전엔 앵커된 일차에만 걸었다. 보통 일차는 체류+이동을 무한정 누적할 수 있어 자정을
      // 넘겼고, 그러면 ScheduleConstraint 가 **시각만** 활동 구간 안으로 되돌려 날짜가 하루
      // 밀린 항목이 남았다(실측: day1 항목이 D+1 07:30 에 저장돼 day2 첫 항목과 충돌). 검증은
      // 전부 시각 기준이라 이걸 잡지 못했다 — 넘치면 시각을 옮길 게 아니라 항목을 줄여야 한다.
      const dayEndAt = this.dayEndAt(context, day);

      for (let order = 0; order < dayPlan.length; order += 1) {
        const planned = dayPlan[order]!;
        const seed = planned.candidate;
        const previous = created[created.length - 1];
        const sameDayPrevious = previous?.day === day ? previous : undefined;
        // 앵커된 일차의 첫 항목은 사용자의 현재 위치에서 출발한다 — 첫 이동을 빼면
        // "지금 그 장소에 이미 도착해 있다" 를 가정하게 된다.
        const from =
          sameDayPrevious?.coordinates ??
          (anchored && order === 0 ? options.currentLocation : undefined);
        const travelTimeMin = from
          ? await this.estimateTravelTime(from, seed.coordinates, trip.transportMode)
          : 0;

        currentAt = new Date(currentAt.getTime() + travelTimeMin * 60000);
        currentAt = this.alignToOpeningHours(currentAt, seed.openingHours);

        const remainMin = Math.floor((dayEndAt - currentAt.getTime()) / 60_000);
        // 45분도 안 남으면 이 항목부터는 그 날 안에 넣을 수 없다.
        if (remainMin < MIN_FITTING_VISIT_MIN) break;
        let durationMin = planned.durationMin;
        if (durationMin > remainMin) {
          // 앵커된 일차는 체류를 줄여서라도 담는다 — "지금 이후"라 남은 시간이 짧은 게 정상이다.
          // 보통 일차는 줄이지 않고 **뺀다**: 줄여서 끼워 넣으면 동선이 나쁜 배치안도
          // "하루에 다 들어갔다"가 되어 근접 재정렬 재시도 신호가 사라진다(흩어진 하루가
          // 45분짜리 방문으로 눌린 채 저장된다).
          if (!anchored) break;
          durationMin = remainMin;
        }

        const item: CreateItineraryItemDto = {
          tripId: trip.id,
          day,
          order: order + 1,
          type: this.toItemType(seed.category),
          name: seed.name,
          address: seed.address,
          coordinates: seed.coordinates,
          scheduledAt: currentAt.toISOString(),
          durationMin,
          memo: this.buildMemo(seed, tasteTags, trip, options, planned.memo, planned.aiGenerated),
        };
        if (seed.kakaoPlaceId) item.kakaoPlaceId = seed.kakaoPlaceId;
        if (seed.openingHours) item.openingHours = seed.openingHours;
        if (seed.phone) item.phoneNumber = seed.phone;
        if (seed.imageUrl) item.imageUrl = seed.imageUrl;
        if (travelTimeMin > 0) item.travelTimeMin = travelTimeMin;
        created.push(item);

        currentAt = new Date(currentAt.getTime() + durationMin * 60000);
      }
    }

    return created.map((item) => ({
      id: `${item.tripId}-${item.day}-${item.order}`,
      tripId: item.tripId,
      day: item.day,
      order: item.order,
      type: item.type,
      name: item.name,
      address: item.address,
      coordinates: item.coordinates,
      scheduledAt: item.scheduledAt,
      durationMin: item.durationMin,
      ...(item.travelTimeMin ? { travelTimeMin: item.travelTimeMin } : {}),
      ...(item.openingHours ? { openingHours: item.openingHours } : {}),
      ...(item.phoneNumber ? { phoneNumber: item.phoneNumber } : {}),
      ...(item.kakaoPlaceId ? { kakaoPlaceId: item.kakaoPlaceId } : {}),
      ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
      memo: `${item.memo ?? ''}${item.memo ? ' · ' : ''}${weatherHint}`,
    }));
  }

  private async validateDraft(
    draft: ItineraryItemDto[],
    context: DraftBuildContext,
  ): Promise<ValidationResult> {
    const bounded = this.scheduleConstraint.apply(draft, {
      wakeTime: context.wakeTime,
      sleepTime: context.sleepTime,
    });
    return this.constraintEngine.validate(bounded, {
      wakeTime: context.wakeTime,
      sleepTime: context.sleepTime,
      transportMode: context.trip.transportMode,
      // 각 항목이 그 일차의 활동 구간(절대 시각)에 드는지까지 보게 한다. 시각만 보던 시절엔
      // 날짜가 하루 밀린 항목이 조용히 저장돼 도착 알림이 엉뚱한 날 떴다.
      tripStartDate: context.trip.startDate,
    });
  }

  /**
   * 배치안을 실제 일정으로 만들고 판정한다.
   *
   * 하드 제약과 **"하루에 다 못 담았다"(shortfall)를 나눠 본다.** `buildDraft` 가 하루 끝을
   * 넘기지 않게 항목을 잘라내므로, 동선이 나쁜 배치안도 짧아진 채로는 제약을 통과한다 —
   * 그것만 보면 근접 재정렬 재시도가 아예 안 돌아 흩어진 하루가 그대로 저장된다.
   * 그래서 잘려 나간 개수를 따로 세어 재시도의 신호로 쓴다.
   */
  private async evaluateDraft(
    plan: PlannedCandidate[],
    context: DraftBuildContext,
  ): Promise<DraftAttempt> {
    const items = await this.buildDraft(plan, context);
    const validation = await this.validateDraft(items, context);
    const shortfall = Math.max(0, this.plannedItemCount(plan, context) - items.length);
    return { validation, shortfall, accepted: validation.valid && shortfall === 0 };
  }

  /** 배치안이 담으려 한 항목 수(일차별 상한 적용 후) — `buildDraft` 의 slice 와 같은 기준. */
  private plannedItemCount(plan: PlannedCandidate[], context: DraftBuildContext): number {
    return context.planDays.reduce((sum, day) => {
      const dayTarget = this.dayItemTarget(context.anchorByDay, day, context.itemsPerDay);
      const dayPlanned = plan.filter((item) => item.day === day).length;
      return sum + Math.min(dayPlanned, dayTarget);
    }, 0);
  }

  private async rebuildValidDraft(
    makePlan: (attempt: number) => PlannedCandidate[],
    context: DraftBuildContext,
    failedAiAttempt: DraftAttempt,
    attempts: number,
  ): Promise<ItineraryItemDto[]> {
    this.logger.warn(
      `AI planner itinerary for trip ${context.trip.id} rejected: ${this.describeAttempt(failedAiAttempt)}`,
    );

    // 제약은 통과했지만 항목이 줄어든 초안 중 가장 덜 줄어든 것. 회차를 다 써도 완전한 안을
    // 못 찾으면 이걸 쓴다 — 짧아진 하루가 여행 생성 실패(503)보다는 낫다.
    let best = failedAiAttempt.validation.valid ? failedAiAttempt : null;
    let last = failedAiAttempt;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      // 근접 재정렬로 필수 장소가 상위 slice 밖으로 밀릴 수 있어 결정적 폴백에서도 강제 주입한다.
      const candidate = await this.evaluateDraft(makePlan(attempt), context);
      if (candidate.accepted) {
        this.logger.log(
          `Recovered valid itinerary for trip ${context.trip.id} with deterministic CRAG fallback attempt ${attempt + 1}`,
        );
        return candidate.validation.items;
      }
      if (candidate.validation.valid && (!best || candidate.shortfall < best.shortfall)) {
        best = candidate;
      }
      last = candidate;
    }

    if (best) {
      this.logger.warn(
        `Trip ${context.trip.id}: 하루에 다 담지 못해 항목 ${best.shortfall}개를 줄여 저장합니다.`,
      );
      return best.validation.items;
    }

    throw new BadRequestException(
      `Generated itinerary violates hard constraints: ${last.validation.issues.join('; ')}`,
    );
  }

  /**
   * 일차별 목표를 못 채운 일정을 경고로 남긴다.
   *
   * 왜 — 여기까지 온 일정은 **제약을 다 통과한 정상 응답**이다. 적게 담은 하루는 아무 제약도
   * 어기지 않으므로(이동·영업시간·활동 구간 전부 통과), 후보 풀이 얇아 3일차가 통째로 비어도
   * 검증은 valid 를 돌려주고 그대로 저장됐다. `shortfall` 은 "배치안 대비 잘려 나간 수"라
   * 애초에 배치안이 짧으면 0 이다 — 그래서 그 경로로도 안 잡힌다.
   *
   * 풀 크기를 함께 찍는 이유는 원인이 둘이기 때문이다 — 후보가 모자랐거나(풀 < 목표),
   * 후보는 있는데 하루에 안 들어갔거나(동선·영업시간). 두 숫자를 나란히 봐야 갈린다.
   *
   * 던지지 않는다 — 짧은 일정도 사용자에겐 쓸모가 있고, 카탈로그가 얇은 목적지는 재시도해도
   * 늘지 않아 실패로 바꾸면 그 목적지는 영구히 일정을 못 만든다.
   */
  private warnDayShortfall(
    items: ItineraryItemDto[],
    context: DraftBuildContext,
    poolSize: number,
  ): void {
    const short = context.planDays
      .map((day) => ({
        day,
        target: this.dayItemTarget(context.anchorByDay, day, context.itemsPerDay),
        actual: items.filter((item) => item.day === day).length,
      }))
      .filter(({ target, actual }) => actual < target);
    if (short.length === 0) return;

    const empty = short.filter(({ actual }) => actual === 0).map(({ day }) => day);
    this.logger.warn(
      `Trip ${context.trip.id} ("${context.trip.destination}") 일정이 목표보다 짧습니다 — ` +
        short.map(({ day, actual, target }) => `${day}일차 ${actual}/${target}`).join(', ') +
        ` (후보 풀 ${poolSize}건)` +
        (empty.length > 0 ? ` · 빈 일차: ${empty.join(', ')}` : ''),
    );
  }

  private describeAttempt(attempt: DraftAttempt): string {
    const parts = [...attempt.validation.issues];
    if (attempt.shortfall > 0) parts.push(`하루에 안 들어간 항목 ${attempt.shortfall}개`);
    return parts.join('; ');
  }

  /**
   * 근접 정렬된 후보를 일차별로 나눠 배치한다.
   *
   * 예전엔 `candidates.slice(offset, offset + dayTarget)` 로 앞에서부터 잘라 담았다. 그런데
   * 풀의 식음 후보는 `selectTopDiverse` 가 **꼬리 자리에 채워 넣기** 때문에 이 슬라이스에
   * 한 번도 걸리지 않았다 — 하루가 통째로 관광지로 채워지던 경로다. 이제 하루의 슬롯 역할
   * (점심·저녁 음식점 / 오후 카페)을 먼저 채우고 나머지를 볼거리로 메운다.
   *
   * `searchWindow` 로 역할 후보 탐색을 근접 체인의 앞쪽으로 제한해 `orderByProximity` 가
   * 만든 지리적 군집을 유지한다 — 창 안에 없을 때만 풀 전체를 훑는다.
   */
  private buildDeterministicPlan(
    candidates: CandidatePlace[],
    context: DraftBuildContext,
  ): PlannedCandidate[] {
    const planned: PlannedCandidate[] = [];
    const used = new Set<string>();
    context.planDays.forEach((day) => {
      const dayTarget = this.dayItemTarget(context.anchorByDay, day, context.itemsPerDay);
      const startTime = this.dayStartTime(context.anchorByDay, day, context.wakeTime);
      const dayCandidates = fillDaySlots({
        pool: candidates,
        used,
        startTime,
        itemCount: dayTarget,
        searchWindow: dayTarget * 2,
      });
      const durations = distributeFallbackDurations(
        dayCandidates.map((candidate) => candidate.category),
        startTime,
        context.sleepTime,
      );
      dayCandidates.forEach((candidate, index) => {
        planned.push({
          candidate,
          day,
          order: index + 1,
          durationMin: durations[index] ?? defaultVisitDuration(candidate.category),
          memo: '식사·휴식 슬롯 기반 배치',
          aiGenerated: false,
        });
      });
    });
    return planned;
  }

  /**
   * 여행의 일자별 지역 목록을 조회한다. trip_days 미설정 시 모든 날을 trip.destination 으로 채운다
   * (단일 지역 여행·기존 데이터 하위호환). 반환 길이는 항상 dayCount 와 같다.
   */
  private async resolveDayRegions(trip: TripEntity, dayCount: number): Promise<string[][]> {
    const rows = await this.tripDaysRepo.find({
      where: { tripId: trip.id },
      order: { day: 'ASC', sortOrder: 'ASC' },
    });
    const byDay = new Map<number, string[]>();
    for (const row of rows) {
      const list = byDay.get(row.day) ?? [];
      list.push(row.region);
      byDay.set(row.day, list);
    }
    return Array.from({ length: dayCount }, (_, index) => {
      const regions = byDay.get(index + 1);
      return regions && regions.length > 0 ? regions : [trip.destination];
    });
  }

  /**
   * 일자별로 그 날 지역(들)의 후보 풀을 만든다. 하루에 여러 지역이면 각 지역을 조회해 id 기준 dedupe.
   * 특정 일차 후보가 비면 여행 내 다른 실제 지역으로 폴백해 빈 일차를 막는다
   * (대표 destination 은 '부산 · 경주' 같은 결합 라벨이라 지역 검색이 안 되므로 쓰지 않는다).
   */
  private async retrievePerDay(
    dayRegions: string[][],
    sharedRetrieval: Omit<RetrievalContext, 'destination' | 'limit'>,
    itemsPerDay: number,
    /** dayRegions 와 1:1 인 일차 날짜('YYYY-MM-DD'). 기간 있는 행사를 그 날로 좁히는 데 쓴다. */
    dayDates: string[],
  ): Promise<CandidatePlace[][]> {
    const perRegionLimit = Math.max(itemsPerDay + 3, 8);
    // 여행 전체의 실제 지역 목록(폴백 후보). 결합 라벨이 아닌 개별 지역만 담긴다.
    const allRegions = [...new Set(dayRegions.flat().map((r) => r.trim()).filter(Boolean))];
    const retrieveRegion = async (region: string, date?: string): Promise<CandidatePlace[]> => {
      const result = await this.placeRetrieval.retrieve({
        ...sharedRetrieval,
        destination: region,
        limit: perRegionLimit,
        // 일자별 풀은 그 하루만 채우므로 하루치 하한이면 된다.
        categoryQuota: dayCategoryQuota(1),
        // 그 일차 하루가 곧 방문 구간이다. 날짜를 모르면 여행 전체 구간(sharedRetrieval)을 쓴다.
        ...(date ? { visitWindow: { from: date, to: date } } : {}),
      });
      return result.places;
    };
    // region 순서대로 id dedupe (앞 지역 우선). 병렬 조회 결과를 순서대로 합쳐 결정성을 유지한다.
    const mergeOrdered = (merged: Map<string, CandidatePlace>, lists: CandidatePlace[][]) => {
      for (const places of lists) {
        for (const place of places) {
          if (!merged.has(place.id)) merged.set(place.id, place);
        }
      }
    };
    return Promise.all(
      dayRegions.map(async (regions, dayIndex) => {
        const date = dayDates[dayIndex];
        const merged = new Map<string, CandidatePlace>();
        // 한 일차의 여러 지역은 서로 독립이라 병렬 조회한다.
        mergeOrdered(
          merged,
          await Promise.all(regions.map((region) => retrieveRegion(region, date))),
        );
        // 그 날 지역이 0건이면 여행 내 다른 지역으로 채운다 (이미 조회한 그 날 지역은 건너뜀).
        if (merged.size === 0) {
          for (const region of allRegions) {
            if (regions.includes(region)) continue;
            mergeOrdered(merged, [await retrieveRegion(region, date)]);
            if (merged.size > 0) break;
          }
        }
        return [...merged.values()];
      }),
    );
  }

  /**
   * 일자별 지역 풀을 각 일차에 그대로 배치한다. buildDraft 가 item.day 로 그룹핑하므로
   * 각 일차는 반드시 그 날 지역 후보로만 채워진다 (지역 간 섞임 없음).
   * `poolsByDay[i]` 는 `planDays[i]` 일차의 풀이다(부분 재계획이면 대상 일차만 들어온다).
   */
  private buildPerDayDeterministicPlan(
    poolsByDay: CandidatePlace[][],
    itemsPerDay: number,
    planDays: number[],
    anchorByDay: Map<number, DayAnchor>,
    wakeTime: string,
  ): PlannedCandidate[] {
    const planned: PlannedCandidate[] = [];
    // 일차별 풀은 지역이 겹치면 같은 후보를 담을 수 있다. 소비한 id 를 공유해 중복 배치를 막는다.
    const used = new Set<string>();
    poolsByDay.forEach((pool, dayIndex) => {
      const day = planDays[dayIndex] ?? dayIndex + 1;
      const startTime = this.dayStartTime(anchorByDay, day, wakeTime);
      // 여기서도 `pool.slice(0, dayTarget)` 을 쓰면 안 된다 — 풀 크기가 `itemsPerDay + 3` 이라
      // 꼬리에 채워진 식음 후보가 정확히 잘려 나가는 자리에 있다.
      fillDaySlots({
        pool,
        used,
        startTime,
        itemCount: this.dayItemTarget(anchorByDay, day, itemsPerDay),
      }).forEach((candidate, index) => {
        planned.push({
          candidate,
          day,
          order: index + 1,
          durationMin: defaultVisitDuration(candidate.category),
          memo: '일자별 지역 후보 · 식사·휴식 슬롯 기반 배치',
          aiGenerated: false,
        });
      });
    });
    return planned;
  }

  /** 여행 노트 + 재계획 요청 노트 + 구조화 옵션을 하나의 지시문으로 합친다. */
  private buildCombinedNotes(
    tripNotes: string | null | undefined,
    options: GenerateOptions,
  ): string | null {
    const parts: string[] = [];
    const push = (value?: string | null) => {
      const trimmed = value?.trim();
      if (trimmed) parts.push(trimmed);
    };
    push(tripNotes);
    push(options.note);
    const mustNames = (options.mustIncludePlaces ?? []).map((p) => p.name?.trim()).filter(Boolean);
    if (mustNames.length > 0) push(`반드시 포함할 장소: ${mustNames.join(', ')}`);
    const prefs = options.preferences;
    if (prefs) {
      push(prefs.avoid ? `피하고 싶은 것: ${prefs.avoid}` : null);
      if (prefs.minimizeTravel) push('이동 동선을 최대한 짧게 구성');
      if (prefs.pace) push(PACE_HINT[prefs.pace]);
      if (prefs.budget) push(BUDGET_HINT[prefs.budget]);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  /** 반드시 포함할 장소를 최상위 시드 후보(CandidatePlace)로 변환한다. */
  private buildMustIncludeCandidates(places?: ReplanRequestDto['mustIncludePlaces']): CandidatePlace[] {
    if (!places?.length) return [];
    return places
      .filter((place) => place?.name && Number.isFinite(place.lat) && Number.isFinite(place.lng))
      .map((place, index) => ({
        id: `must-${index}-${place.lat},${place.lng}`,
        name: place.name,
        category: place.category?.trim() || '관광',
        address: place.address?.trim() || `${place.name} 인근`,
        coordinates: { lat: place.lat, lng: place.lng },
        source: 'seed' as const,
        tags: ['사용자 필수 포함'],
        confidence: 1,
        reason: '사용자가 반드시 포함을 요청한 장소',
        crag: {
          total: 1,
          retrieval: 1,
          taste: 1,
          locality: 1,
          context: 1,
          availability: 1,
          popularity: 1,
          matchedTags: [],
          penalties: [],
        },
      }));
  }

  /**
   * 필수 포함 장소가 계획에 없으면 강제로 주입한다. 이미 있으면(이름 일치 또는 좌표 근접)
   * 그대로 둔다. 누락분은 각 일차에 라운드로빈으로 배치하되 `order` 를 음수로 줘,
   * `buildDraft` 의 일차별 `order` 정렬·`slice(0, itemsPerDay)` 에서 최상단으로 살아남게 한다
   * (초과분은 순위 낮은 비필수 항목이 밀려남).
   */
  private enforceMustInclude(
    plan: PlannedCandidate[],
    mustCandidates: CandidatePlace[],
    planDays: number[],
    regionScoped = false,
  ): PlannedCandidate[] {
    if (mustCandidates.length === 0) return plan;

    const norm = (value: string) => value.trim().toLowerCase();
    const isSame = (a: CandidatePlace, b: CandidatePlace) =>
      norm(a.name) === norm(b.name) ||
      (Math.abs(a.coordinates.lat - b.coordinates.lat) < 1e-4 &&
        Math.abs(a.coordinates.lng - b.coordinates.lng) < 1e-4);

    const missing = mustCandidates.filter(
      (must) => !plan.some((planned) => isSame(planned.candidate, must)),
    );
    if (missing.length === 0) return plan;

    // 일자별 지역 모드: 이미 배치된 후보 중 좌표가 가장 가까운 항목의 일차에 넣어
    // must 장소가 엉뚱한 지역 일차에 섞이지 않게 한다. 배치안이 비었으면 라운드로빈 폴백.
    // 라운드로빈 대상은 이번에 다시 짜는 일차뿐이다 — 부분 재계획에서 필수 장소가
    // 손대지 않는 일차로 새어 나가면 그 일차 항목이 밀려난다.
    const pickDay = (must: CandidatePlace, index: number): number => {
      if (!regionScoped || plan.length === 0) return planDays[index % planDays.length]!;
      let bestDay = plan[0]!.day;
      let bestDist = Infinity;
      for (const planned of plan) {
        const dLat = planned.candidate.coordinates.lat - must.coordinates.lat;
        const dLng = planned.candidate.coordinates.lng - must.coordinates.lng;
        const dist = dLat * dLat + dLng * dLng;
        if (dist < bestDist) {
          bestDist = dist;
          bestDay = planned.day;
        }
      }
      return bestDay;
    };

    const result = [...plan];
    missing.forEach((must, index) => {
      result.push({
        candidate: must,
        day: pickDay(must, index),
        // 음수 order → 해당 일차 정렬 최상단. buildDraft 가 최종 order 를 다시 매기므로 값 자체는 표시 안 됨.
        order: -1000 + index,
        durationMin: defaultVisitDuration(must.category),
        memo: '사용자가 반드시 포함을 요청한 장소',
        aiGenerated: false,
      });
    });
    return result;
  }

  /**
   * 재계획 전 저장돼 있던 항목들의 사용자 memo 를 장소 키로 색인한다.
   * 초기 생성 시에는 기존 항목이 없어 빈 Map 이 반환된다.
   */
  private indexMemosByPlace(existing: ItineraryItemEntity[]): Map<string, string> {
    const byPlace = new Map<string, string>();
    for (const item of existing) {
      const memo = item.memo?.trim();
      if (memo) byPlace.set(this.placeMemoKey(item), memo);
    }
    return byPlace;
  }

  /**
   * 같은 장소를 재계획 전후로 잇기 위한 키. kakaoPlaceId 가 가장 안정적이고,
   * 없으면 이름 + 좌표(소수 4자리) 로 대체한다. 좌표를 반올림해 미세한 오차로
   * 매칭이 깨지지 않게 한다.
   */
  private placeMemoKey(item: {
    kakaoPlaceId?: string;
    name: string;
    coordinates: PlaceDto['coordinates'];
  }): string {
    if (item.kakaoPlaceId) return `kakao:${item.kakaoPlaceId}`;
    return `name:${item.name.trim()}@${item.coordinates.lat.toFixed(4)},${item.coordinates.lng.toFixed(4)}`;
  }

  private buildMemo(
    place: CandidatePlace,
    tasteTags: TasteTagDto | undefined,
    trip: TripEntity,
    options: GenerateOptions,
    agentMemo: string,
    aiGenerated: boolean,
  ): string {
    const keywords = [
      ...(tasteTags?.food ?? []),
      ...(tasteTags?.mood ?? []),
      ...(tasteTags?.environment ?? []),
    ].filter((tag) => place.tags.includes(tag));

    const base = keywords.length > 0
      ? `선호 태그(${keywords.join(', ')}) 기준 추천`
      : `${trip.destination} 대표 동선에 맞춘 추천`;
    const cragEvidence = `CRAG ${place.source} confidence ${Math.round(place.confidence * 100)}%; ${place.reason}`;
    const agentEvidence = aiGenerated
      ? `AI planner 생성: ${agentMemo}`
      : `AI planner fallback: ${agentMemo}`;

    const triggerNote = options.trigger ? TRIGGER_MEMO_NOTE[options.trigger] : undefined;
    return [base, agentEvidence, cragEvidence, ...(triggerNote ? [triggerNote] : [])].join('; ');
  }

  private toItemType(category: string): ItineraryItemDto['type'] {
    if (category === 'restaurant') return 'restaurant';
    if (category === 'cafe') return 'cafe';
    return 'attraction';
  }

  private offsetDate(dateText: string, offset: number): string {
    // UTC 정수 연산으로 일수만 더한다. new Date(+09:00) 인스턴스를 로컬 getter 로 다시
    // 읽으면 UTC 컨테이너에서 하루가 밀린다(offset 0 조차 전날이 됨).
    return addDaysToIsoDate(dateText, offset);
  }

  private makeDateTime(dateText: string, timeText: string): Date {
    return new Date(`${dateText}T${timeText}:00+09:00`);
  }

  /**
   * 개장 전 도착이면 개장 시각으로 미룬다.
   *
   * ⚠️ 날짜는 그 시각의 **KST 날짜**로 다시 만든다. 예전엔 `setUTCHours(개장시 - 9, …)` 로
   * 시간만 바꿨는데, KST 09:00 이전 시각은 UTC 날짜가 하루 전이라 결과가 통째로 전날로 갔다
   * (기본 기상 08:30 + 09:00 개장 → 08-21 08:30 이 08-20 09:00 이 됨). 검증이 전부 시각
   * 기준이라 이 하루 밀림은 아무 데서도 안 걸렸다.
   */
  private alignToOpeningHours(date: Date, openingHours?: string): Date {
    if (!openingHours) return date;
    const match = openingHours.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!match) return date;

    const [, startHour, startMinute] = match;
    const openingMinutes = Number(startHour) * 60 + Number(startMinute);
    if (getKstMinutes(date) >= openingMinutes) return date;

    return this.makeDateTime(toKstIsoDate(date), `${startHour}:${startMinute}`);
  }

  /**
   * 재시도용 후보 정렬 — 시드 하나를 잡고, 남은 후보 중 **직전에 배치한 장소에서 가장 가까운
   * 것**을 차례로 잇는다(그리디 최근접 순회). `buildDeterministicPlan`·
   * `buildPerDayDeterministicPlan` 이 이 순서를 앞에서부터 잘라 일차를 채우므로, 정렬만 바꿔도
   * 한 일차가 지리적으로 뭉친 후보로 채워진다.
   *
   * 이전 단순 회전(rotate)은 CRAG 점수 순서를 그대로 두고 시작점만 옮겼다. pgvector 카탈로그가
   * 시도 단위로 적재돼 있어 "부산광역시" 같은 광역 목적지는 상위 후보가 해운대·금정산·오륙도로
   * 흩어지는데, 그러면 어느 회전에서도 이동시간 제약을 못 맞춰 여행 생성이 통째로 롤백됐다.
   *
   * 거리는 하버사인 직선거리로만 본다 — 실제 경로 조회는 후보 수의 제곱만큼 외부 API 를 때리므로
   * 순위만 정하는 데는 과하다. 최종 판정은 어차피 `ConstraintEngine` 이 실제 ETA 로 한다.
   *
   * CRAG 점수 체계(취향·popularity)는 손대지 않는다 — 여기 들어오는 후보는 이미 취향 상위로
   * 걸러진 풀이고, 이 정렬은 그 안에서의 **방문 순서**만 정한다.
   *
   * @param attempt 재시도 회차. 시드를 바꿔 회차마다 다른 군집(=다른 일차 경계)을 만든다.
   * @param origin  첫 이동의 실제 출발지(오늘 일차를 다시 짤 때의 사용자 현재 위치).
   *                주면 거기서 가까운 순으로 시드를 고른다.
   */
  private orderByProximity<T extends { coordinates: PlaceDto['coordinates'] }>(
    candidates: T[],
    attempt: number,
    origin?: PlaceDto['coordinates'],
  ): T[] {
    if (candidates.length === 0) return [];

    // 시드 후보 순서: origin 이 있으면 거기서 가까운 순, 없으면 CRAG 순위 그대로.
    const seedOrder = origin
      ? [...candidates].sort(
          (a, b) =>
            haversineMeters(origin, a.coordinates) - haversineMeters(origin, b.coordinates),
        )
      : candidates;
    const remaining = [...candidates];
    const seed = seedOrder[attempt % seedOrder.length]!;
    const ordered: T[] = remaining.splice(remaining.indexOf(seed), 1);

    while (remaining.length > 0) {
      const from = ordered[ordered.length - 1]!.coordinates;
      let bestIndex = 0;
      let bestDistance = Infinity;
      remaining.forEach((candidate, index) => {
        const distance = haversineMeters(from, candidate.coordinates);
        // 부등호가 `<` 이라 같은 거리면 앞선 후보(= CRAG 상위)가 남는다.
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      ordered.push(...remaining.splice(bestIndex, 1));
    }
    return ordered;
  }

  /**
   * 그 일차 첫 이동의 출발지. 오늘을 다시 짜는 일차(앵커 있음)만 사용자의 현재 위치에서
   * 출발한다 — `buildDraft` 가 앵커된 일차의 첫 항목 이동시간을 현재 위치 기준으로 재는 것과
   * 같은 기준이어야, 근접 정렬이 고른 순서와 실제 이동시간 계산이 어긋나지 않는다.
   */
  private dayOrigin(context: DraftBuildContext, day: number): PlaceDto['coordinates'] | undefined {
    if (!context.anchorByDay.has(day)) return undefined;
    return context.options.currentLocation;
  }

  private async estimateTravelTime(
    from: PlaceDto['coordinates'],
    to: PlaceDto['coordinates'],
    transportMode: TripEntity['transportMode'],
  ): Promise<number> {
    const eta = await this.routeHelper.getEta(from, to, transportMode ?? 'transit');
    return Math.max(15, Math.ceil(eta.durationSec / 60));
  }

  private assertTripWindow(trip: TripEntity): void {
    if (trip.endDate < trip.startDate) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
  }
}
