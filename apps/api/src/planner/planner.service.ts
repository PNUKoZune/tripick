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
  minimumItemsPerDay,
  targetItemsPerDay,
} from './helpers/itinerary-density';
import { ConstraintEngine, type ValidationResult } from './constraint/constraint.engine';
import { PlannerAgentService } from './agent/planner-agent.service';
import type { PlannedCandidate } from './agent/planner-agent.service';
import { PlaceRetrievalService } from './retrieval/place-retrieval.service';
import { TripEntity } from '../trips/trip.entity';
import { TripDayEntity } from '../trips/trip-day.entity';
import { addDaysToIsoDate, countTripDays } from '@tripick/utils';
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
import type { CandidatePlace, RetrievalContext } from './retrieval/types';

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

interface GenerateOptions {
  trigger?: ReplanRequestDto['trigger'];
  deviatedItemId?: string;
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

interface DraftBuildContext {
  trip: TripEntity;
  dayCount: number;
  /** 이번 생성이 실제로 채우는 일차 목록(오름차순). 전체 생성이면 1..dayCount */
  planDays: number[];
  itemsPerDay: number;
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
      ...(request.deviatedItemId !== undefined ? { deviatedItemId: request.deviatedItemId } : {}),
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
    // 이번에 다시 짤 일차. 부분 재계획이면 나머지 일차는 저장된 일정을 그대로 둔다.
    const planDays = this.resolvePlanDays(options.targetDays, dayCount);
    const partial = planDays.length < dayCount;
    const wakeTime = trip.wakeTime ?? '08:30';
    const sleepTime = trip.sleepTime ?? '22:00';
    const pace = options.preferences?.pace ?? preference?.profile?.pace;
    // 강도별 3/4/5개는 최소 밀도다. 활동 시간이 길면 하루가 일찍 끝나지 않도록 늘린다.
    const minimumDailyItems = minimumItemsPerDay(pace);
    const itemsPerDay = targetItemsPerDay(pace, wakeTime, sleepTime);
    // 여행 고정 노트 + 재계획 요청 노트 + 구조화 옵션을 하나의 지시문으로 합쳐 검색·프롬프트에 반영
    const combinedNotes = this.buildCombinedNotes(trip.notes, options);
    // 검색 컨텍스트 중 지역(destination)·개수(limit) 외 공통 항목. 단일/일자별 두 경로가 공유한다.
    const sharedRetrieval = {
      userId: trip.userId,
      notes: combinedNotes,
      // 부분 재계획이면 여행 시작일이 아니라 다시 짜는 첫 일차 기준으로 영업시간·가용성을 본다.
      startAt: this.makeDateTime(this.offsetDate(trip.startDate, planDays[0]! - 1), wakeTime),
      ...(tasteTags !== undefined ? { tasteTags } : {}),
      ...(preferenceVector ? { preferenceVector } : {}),
      ...(options.trigger !== undefined ? { trigger: options.trigger } : {}),
      ...(options.currentLocation !== undefined ? { currentLocation: options.currentLocation } : {}),
    } satisfies Omit<RetrievalContext, 'destination' | 'limit'>;

    // 반드시 포함할 장소는 최상위 후보로 시드해 배치 우선순위를 높인다
    const mustCandidates = this.buildMustIncludeCandidates(options.mustIncludePlaces);
    // 저장된 기존 항목. 사용자 memo 보존 + (부분 재계획 시) 유지되는 일차 파악에 쓴다.
    const existingItems = await this.itineraryService.findByTrip(trip.id, trip.userId);
    // 부분 재계획에서 다시 짜지 않는 일차의 항목들 — 그대로 남기고 중복 배치도 막는다.
    const keptItems = partial ? existingItems.filter((item) => !planDays.includes(item.day)) : [];
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
      poolsByDay = (await this.retrievePerDay(planDayRegions, sharedRetrieval, itemsPerDay)).map(
        (pool) => this.excludeKeptPlaces(pool, keptItems),
      );
      candidates = [...mustCandidates, ...poolsByDay.flat()];
      traceLabel = `per-day[${planDayRegions.map((regions) => regions.join('/')).join(' | ')}]`;
    } else {
      const retrieval = await this.placeRetrieval.retrieve({
        ...sharedRetrieval,
        destination: trip.destination,
        limit: Math.max(planDays.length * itemsPerDay + 4, 12),
      });
      candidates = [...mustCandidates, ...this.excludeKeptPlaces(retrieval.places, keptItems)];
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
      ? this.buildPerDayDeterministicPlan(poolsByDay!, itemsPerDay, planDays)
      : this.remapPlanDays(
          await this.plannerAgent.plan({
            destination: trip.destination,
            dayDates: planDates,
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
      wakeTime,
      sleepTime,
      tasteTags,
      options,
      weatherHint,
    };
    // LLM 이 필수 포함 장소를 누락했으면 강제로 주입한다(시드+프롬프트는 best-effort 라 보장 안 됨).
    const guaranteedPlan = this.enforceMustInclude(agentPlan, mustCandidates, planDays, perDayMode);
    const aiDraft = await this.buildDraft(guaranteedPlan, draftContext);
    const aiValidation = await this.validateDraft(aiDraft, draftContext);
    // 검증 실패 시 후보 rotate 기반 결정적 재생성. 모드에 맞는 배치 생성기를 넘긴다.
    const rebuildAttempts = perDayMode
      ? Math.min(3, Math.max(1, ...poolsByDay!.map((pool) => pool.length)))
      : Math.min(3, candidates.length);
    const planFactory = perDayMode
      ? (attempt: number) =>
          this.enforceMustInclude(
            this.buildPerDayDeterministicPlan(
              poolsByDay!.map((pool) => this.rotate(pool, attempt)),
              itemsPerDay,
              planDays,
            ),
            mustCandidates,
            planDays,
            true,
          )
      : (attempt: number) =>
          this.enforceMustInclude(
            this.buildDeterministicPlan(this.rotate(candidates, attempt), draftContext),
            mustCandidates,
            planDays,
          );
    const finalItems = aiValidation.valid
      ? aiValidation.items
      : await this.rebuildValidDraft(planFactory, draftContext, aiValidation, rebuildAttempts);

    // memo 는 사용자가 직접 남기는 메모 공간이므로 생성 단계의 AI 추론(취향·confidence·
    // 날씨 힌트)을 저장하지 않는다. 새 일정의 memo 는 비어 있는 채로 시작한다.
    // 단, 재계획으로 항목을 갈아끼울 때 같은 장소가 다시 배치되면 사용자가 남긴 기존 memo
    // (예약 시간·준비물 등)를 이어받는다. replaceTripItems 가 기존 항목을 전부 삭제하므로
    // 여기서 미리 보존하지 않으면 사용자 메모가 사라진다.
    const memoByPlace = this.indexMemosByPlace(existingItems);
    const toStore: CreateItineraryItemDto[] = finalItems.map((item) => {
      const preservedMemo = memoByPlace.get(this.placeMemoKey(item));
      return {
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
        ...(preservedMemo ? { memo: preservedMemo } : {}),
      } as CreateItineraryItemDto;
    });

    // 부분 재계획은 대상 일차만 갈아끼운다. 전체 재계획은 기존대로 통째로 교체.
    const saved = partial
      ? await this.itineraryService.replaceDayItems(trip.id, planDays, toStore)
      : await this.itineraryService.replaceTripItems(trip.id, toStore);
    this.logger.log(
      `Generated ${saved.length} itinerary items for trip ${trip.id} (days ${planDays.join(',')}) using CRAG ${traceLabel}`,
    );
    // 유지한 일차 + 새로 저장한 일차를 합쳐 항상 여행 전체 일정을 돌려준다
    // (WS `updatedItems` 를 그대로 화면에 얹는 소비자가 남은 일차를 잃지 않도록).
    return [...keptItems, ...saved]
      .sort((a, b) => a.day - b.day || a.order - b.order)
      .map((item) => this.toItemDto(item));
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
    const { trip, planDays, itemsPerDay, wakeTime, tasteTags, options, weatherHint } = context;
    const created: CreateItineraryItemDto[] = [];

    for (const day of planDays) {
      const dayPlan = plan
        .filter((item) => item.day === day)
        .sort((a, b) => a.order - b.order)
        .slice(0, itemsPerDay);
      let currentAt = this.makeDateTime(this.offsetDate(trip.startDate, day - 1), wakeTime);

      for (let order = 0; order < dayPlan.length; order += 1) {
        const planned = dayPlan[order]!;
        const seed = planned.candidate;
        const durationMin = planned.durationMin;
        const previous = created[created.length - 1];
        const sameDayPrevious = previous?.day === day ? previous : undefined;
        const travelTimeMin = sameDayPrevious
          ? await this.estimateTravelTime(
              sameDayPrevious.coordinates,
              seed.coordinates,
              trip.transportMode,
            )
          : 0;

        currentAt = new Date(currentAt.getTime() + travelTimeMin * 60000);
        currentAt = this.alignToOpeningHours(currentAt, seed.openingHours);

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
    });
  }

  private async rebuildValidDraft(
    makePlan: (attempt: number) => PlannedCandidate[],
    context: DraftBuildContext,
    failedAiValidation: ValidationResult,
    attempts: number,
  ): Promise<ItineraryItemDto[]> {
    this.logger.warn(
      `AI planner itinerary for trip ${context.trip.id} violated hard constraints: ${failedAiValidation.issues.join('; ')}`,
    );

    let lastValidation = failedAiValidation;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      // 후보 rotate 로 필수 장소가 상위 slice 밖으로 밀릴 수 있어 결정적 폴백에서도 강제 주입한다.
      const fallbackPlan = makePlan(attempt);
      const fallbackDraft = await this.buildDraft(fallbackPlan, context);
      const fallbackValidation = await this.validateDraft(fallbackDraft, context);
      if (fallbackValidation.valid) {
        this.logger.log(
          `Recovered valid itinerary for trip ${context.trip.id} with deterministic CRAG fallback attempt ${attempt + 1}`,
        );
        return fallbackValidation.items;
      }
      lastValidation = fallbackValidation;
    }

    throw new BadRequestException(
      `Generated itinerary violates hard constraints: ${lastValidation.issues.join('; ')}`,
    );
  }

  private buildDeterministicPlan(
    candidates: CandidatePlace[],
    context: DraftBuildContext,
  ): PlannedCandidate[] {
    const planned: PlannedCandidate[] = [];
    context.planDays.forEach((day, dayIndex) => {
      const offset = dayIndex * context.itemsPerDay;
      const dayCandidates = candidates.slice(offset, offset + context.itemsPerDay);
      const durations = distributeFallbackDurations(
        dayCandidates.map((candidate) => candidate.category),
        context.wakeTime,
        context.sleepTime,
      );
      dayCandidates.forEach((candidate, index) => {
        planned.push({
          candidate,
          day,
          order: index + 1,
          durationMin: durations[index] ?? defaultVisitDuration(candidate.category),
          memo: 'CRAG 후보 순위 기반 배치',
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
  ): Promise<CandidatePlace[][]> {
    const perRegionLimit = Math.max(itemsPerDay + 3, 8);
    // 여행 전체의 실제 지역 목록(폴백 후보). 결합 라벨이 아닌 개별 지역만 담긴다.
    const allRegions = [...new Set(dayRegions.flat().map((r) => r.trim()).filter(Boolean))];
    const retrieveRegion = async (region: string): Promise<CandidatePlace[]> => {
      const result = await this.placeRetrieval.retrieve({
        ...sharedRetrieval,
        destination: region,
        limit: perRegionLimit,
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
      dayRegions.map(async (regions) => {
        const merged = new Map<string, CandidatePlace>();
        // 한 일차의 여러 지역은 서로 독립이라 병렬 조회한다.
        mergeOrdered(merged, await Promise.all(regions.map((region) => retrieveRegion(region))));
        // 그 날 지역이 0건이면 여행 내 다른 지역으로 채운다 (이미 조회한 그 날 지역은 건너뜀).
        if (merged.size === 0) {
          for (const region of allRegions) {
            if (regions.includes(region)) continue;
            mergeOrdered(merged, [await retrieveRegion(region)]);
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
  ): PlannedCandidate[] {
    const planned: PlannedCandidate[] = [];
    poolsByDay.forEach((pool, dayIndex) => {
      const day = planDays[dayIndex] ?? dayIndex + 1;
      pool.slice(0, itemsPerDay).forEach((candidate, index) => {
        planned.push({
          candidate,
          day,
          order: index + 1,
          durationMin: defaultVisitDuration(candidate.category),
          memo: '일자별 지역 후보 순위 기반 배치',
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

  private alignToOpeningHours(date: Date, openingHours?: string): Date {
    if (!openingHours) return date;
    const match = openingHours.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!match) return date;

    const [, startHour, startMinute] = match;
    const currentKstMinutes = ((date.getUTCHours() * 60 + date.getUTCMinutes()) + 9 * 60) % (24 * 60);
    const openingMinutes = Number(startHour) * 60 + Number(startMinute);
    if (currentKstMinutes >= openingMinutes) {
      return date;
    }

    const adjusted = new Date(date);
    adjusted.setUTCHours(Number(startHour) - 9, Number(startMinute), 0, 0);
    return adjusted;
  }

  private rotate<T>(items: T[], offset: number): T[] {
    if (items.length === 0) return [];
    const pivot = offset % items.length;
    return [...items.slice(pivot), ...items.slice(0, pivot)];
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
