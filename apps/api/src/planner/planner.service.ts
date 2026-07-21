import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItineraryService } from '../itinerary/itinerary.service';
import { PreferencesService } from '../preferences/preferences.service';
import { WeatherHelper } from './helpers/weather.helper';
import { RouteHelper } from './helpers/route.helper';
import { ScheduleConstraint } from './helpers/schedule.constraint';
import { ConstraintEngine, type ValidationResult } from './constraint/constraint.engine';
import { PlannerAgentService } from './agent/planner-agent.service';
import type { PlannedCandidate } from './agent/planner-agent.service';
import { PlaceRetrievalService } from './retrieval/place-retrieval.service';
import { TripEntity } from '../trips/trip.entity';
import { addDaysToIsoDate } from '@tripick/utils';
import type {
  CreateItineraryItemDto,
  ItineraryItemDto,
  PlaceDto,
  ReplanBudget,
  ReplanPace,
  ReplanRequestDto,
  TasteTagDto,
} from '@tripick/types';
import type { CandidatePlace } from './retrieval/types';

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

interface GenerateOptions {
  trigger?: ReplanRequestDto['trigger'];
  deviatedItemId?: string;
  currentLocation?: ReplanRequestDto['currentLocation'];
  /** 사용자 자유 텍스트 요청. 검색·프롬프트 notes 에 합쳐진다 */
  note?: string;
  /** 반드시 포함할 장소들 (후보 상위에 시드 + 프롬프트 반영) */
  mustIncludePlaces?: ReplanRequestDto['mustIncludePlaces'];
  /** 구조화 재계획 옵션 (강도·회피·동선·예산) */
  preferences?: ReplanRequestDto['preferences'];
}

interface DraftBuildContext {
  trip: TripEntity;
  dayCount: number;
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
    const dayCount = this.getDayCount(trip.startDate, trip.endDate);
    const wakeTime = trip.wakeTime ?? '08:30';
    const sleepTime = trip.sleepTime ?? '22:00';
    // 일정 강도(pace)에 따라 하루 일정 개수를 조절한다
    const itemsPerDay = this.itemsPerDayForPace(options.preferences?.pace);
    // 여행 고정 노트 + 재계획 요청 노트 + 구조화 옵션을 하나의 지시문으로 합쳐 검색·프롬프트에 반영
    const combinedNotes = this.buildCombinedNotes(trip.notes, options);
    const retrieval = await this.placeRetrieval.retrieve({
      userId: trip.userId,
      destination: trip.destination,
      notes: combinedNotes,
      limit: Math.max(dayCount * itemsPerDay + 4, 12),
      startAt: this.makeDateTime(trip.startDate, wakeTime),
      ...(tasteTags !== undefined ? { tasteTags } : {}),
      ...(preferenceVector ? { preferenceVector } : {}),
      ...(options.trigger !== undefined ? { trigger: options.trigger } : {}),
      ...(options.currentLocation !== undefined ? { currentLocation: options.currentLocation } : {}),
    });
    // 반드시 포함할 장소는 최상위 후보로 시드해 배치 우선순위를 높인다
    const mustCandidates = this.buildMustIncludeCandidates(options.mustIncludePlaces);
    const candidates = [...mustCandidates, ...retrieval.places];

    if (candidates.length === 0) {
      throw new BadRequestException('No place candidates found for itinerary generation');
    }

    const firstCandidate = candidates[0];
    const forecast = firstCandidate
      ? await this.weatherHelper.getExtendedForecast(firstCandidate.coordinates.lat, firstCandidate.coordinates.lng)
      : new Map();
    const weatherHint = this.weatherHelper.buildWeatherHint(forecast);
    const agentPlan = await this.plannerAgent.plan({
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      wakeTime,
      sleepTime,
      transportMode: trip.transportMode,
      dayCount,
      itemsPerDay,
      candidates,
      notes: combinedNotes,
      weatherHint,
      ...(tasteTags !== undefined ? { tasteTags } : {}),
      ...(options.trigger !== undefined ? { trigger: options.trigger } : {}),
    });

    const draftContext: DraftBuildContext = {
      trip,
      dayCount,
      itemsPerDay,
      wakeTime,
      sleepTime,
      tasteTags,
      options,
      weatherHint,
    };
    // LLM 이 필수 포함 장소를 누락했으면 강제로 주입한다(시드+프롬프트는 best-effort 라 보장 안 됨).
    const guaranteedPlan = this.enforceMustInclude(agentPlan, mustCandidates, dayCount);
    const aiDraft = await this.buildDraft(guaranteedPlan, draftContext);
    const aiValidation = await this.validateDraft(aiDraft, draftContext);
    const finalItems = aiValidation.valid
      ? aiValidation.items
      : await this.rebuildValidDraft(candidates, draftContext, aiValidation);

    // memo 는 사용자가 직접 남기는 메모 공간이므로 생성 단계의 AI 추론(취향·confidence·
    // 날씨 힌트)을 저장하지 않는다. 새 일정의 memo 는 비어 있는 채로 시작한다.
    // 단, 재계획으로 항목을 갈아끼울 때 같은 장소가 다시 배치되면 사용자가 남긴 기존 memo
    // (예약 시간·준비물 등)를 이어받는다. replaceTripItems 가 기존 항목을 전부 삭제하므로
    // 여기서 미리 보존하지 않으면 사용자 메모가 사라진다.
    const memoByPlace = await this.collectExistingMemos(trip);
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

    const saved = await this.itineraryService.replaceTripItems(trip.id, toStore);
    this.logger.log(
      `Generated ${saved.length} itinerary items for trip ${trip.id} using CRAG sources=${retrieval.trace.sources.join('+')} avg=${retrieval.trace.averageConfidence.toFixed(2)}`,
    );
    return saved.map((item) => ({
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
    }));
  }

  private async buildDraft(
    plan: PlannedCandidate[],
    context: DraftBuildContext,
  ): Promise<ItineraryItemDto[]> {
    const { trip, dayCount, itemsPerDay, wakeTime, tasteTags, options, weatherHint } = context;
    const created: CreateItineraryItemDto[] = [];

    for (let day = 1; day <= dayCount; day += 1) {
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
          name: this.buildPlaceName(seed.name, options.trigger, day, order),
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
    candidates: CandidatePlace[],
    context: DraftBuildContext,
    failedAiValidation: ValidationResult,
  ): Promise<ItineraryItemDto[]> {
    this.logger.warn(
      `AI planner itinerary for trip ${context.trip.id} violated hard constraints: ${failedAiValidation.issues.join('; ')}`,
    );

    const mustCandidates = this.buildMustIncludeCandidates(context.options.mustIncludePlaces);
    let lastValidation = failedAiValidation;
    const attempts = Math.min(3, candidates.length);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      // 후보 rotate 로 필수 장소가 상위 slice 밖으로 밀릴 수 있어 결정적 폴백에서도 강제 주입한다.
      const fallbackPlan = this.enforceMustInclude(
        this.buildDeterministicPlan(
          this.rotate(candidates, attempt),
          context.dayCount,
          context.itemsPerDay,
        ),
        mustCandidates,
        context.dayCount,
      );
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
    dayCount: number,
    itemsPerDay: number,
  ): PlannedCandidate[] {
    const targetCount = Math.min(candidates.length, dayCount * itemsPerDay);
    return Array.from({ length: targetCount }, (_, index) => {
      const candidate = candidates[index]!;
      return {
        candidate,
        day: Math.floor(index / itemsPerDay) + 1,
        order: (index % itemsPerDay) + 1,
        durationMin: this.defaultDuration(candidate.category),
        memo: 'CRAG 후보 순위 기반 배치',
        aiGenerated: false,
      };
    });
  }

  /** 일정 강도(pace) → 하루 일정 개수 */
  private itemsPerDayForPace(pace?: ReplanPace): number {
    if (pace === 'relaxed') return 3;
    if (pace === 'packed') return 5;
    return 4;
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
          dataQuality: 1,
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
    dayCount: number,
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

    const result = [...plan];
    missing.forEach((must, index) => {
      result.push({
        candidate: must,
        day: (index % dayCount) + 1,
        // 음수 order → 해당 일차 정렬 최상단. buildDraft 가 최종 order 를 다시 매기므로 값 자체는 표시 안 됨.
        order: -1000 + index,
        durationMin: this.defaultDuration(must.category),
        memo: '사용자가 반드시 포함을 요청한 장소',
        aiGenerated: false,
      });
    });
    return result;
  }

  private buildPlaceName(name: string, trigger: GenerateOptions['trigger'], day: number, order: number): string {
    if (!trigger) return name;
    if (day === 1 && order >= 1) {
      return `${name} (${trigger} 대응)`;
    }
    return name;
  }

  /**
   * 재계획 전 저장돼 있던 항목들의 사용자 memo 를 장소 키로 색인한다.
   * 초기 생성 시에는 기존 항목이 없어 빈 Map 이 반환된다.
   */
  private async collectExistingMemos(trip: TripEntity): Promise<Map<string, string>> {
    const existing = await this.itineraryService.findByTrip(trip.id, trip.userId);
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

    if (options.trigger === 'manual') {
      return `${base}; ${agentEvidence}; ${cragEvidence}; 수동 재계획 요청 반영`;
    }
    if (options.trigger === 'deviation') {
      return `${base}; ${agentEvidence}; ${cragEvidence}; 이탈 상황에서 복귀 쉬운 순서로 재배치`;
    }
    if (options.trigger === 'weather') {
      return `${base}; ${agentEvidence}; ${cragEvidence}; 날씨 이벤트를 고려해 실내/대체 가능 장소 우선`;
    }
    return `${base}; ${agentEvidence}; ${cragEvidence}`;
  }

  private toItemType(category: string): ItineraryItemDto['type'] {
    if (category === 'restaurant') return 'restaurant';
    if (category === 'cafe') return 'cafe';
    return 'attraction';
  }

  private getDayCount(startDate: string, endDate: string): number {
    const start = new Date(`${startDate}T00:00:00+09:00`);
    const end = new Date(`${endDate}T00:00:00+09:00`);
    const diff = Math.floor((end.getTime() - start.getTime()) / 86400000);
    return Math.max(1, diff + 1);
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

  private defaultDuration(category: string): number {
    if (category === 'restaurant') return 80;
    if (category === 'cafe') return 60;
    return 90;
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
