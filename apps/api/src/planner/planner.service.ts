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
import type { CreateItineraryItemDto, ItineraryItemDto, PlaceDto, ReplanRequestDto, TasteTagDto } from '@tripick/types';
import type { CandidatePlace } from './retrieval/types';

interface GenerateOptions {
  trigger?: ReplanRequestDto['trigger'];
  waitingMinutes?: number;
  deviatedItemId?: string;
  currentLocation?: ReplanRequestDto['currentLocation'];
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
      ...(request.waitingMinutes !== undefined ? { waitingMinutes: request.waitingMinutes } : {}),
      ...(request.deviatedItemId !== undefined ? { deviatedItemId: request.deviatedItemId } : {}),
      ...(request.currentLocation !== undefined ? { currentLocation: request.currentLocation } : {}),
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
    const itemsPerDay = 4;
    const retrieval = await this.placeRetrieval.retrieve({
      userId: trip.userId,
      destination: trip.destination,
      notes: trip.notes,
      limit: Math.max(dayCount * itemsPerDay + 4, 12),
      startAt: this.makeDateTime(trip.startDate, wakeTime),
      ...(tasteTags !== undefined ? { tasteTags } : {}),
      ...(preferenceVector ? { preferenceVector } : {}),
      ...(options.trigger !== undefined ? { trigger: options.trigger } : {}),
      ...(options.currentLocation !== undefined ? { currentLocation: options.currentLocation } : {}),
    });
    const candidates = retrieval.places;

    if (candidates.length === 0) {
      throw new BadRequestException('No place candidates found for itinerary generation');
    }

    const firstCandidate = candidates[0];
    const forecast = firstCandidate
      ? await this.weatherHelper.getForecast(firstCandidate.coordinates.lat, firstCandidate.coordinates.lng, new Date(trip.startDate))
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
      notes: trip.notes,
      weatherHint,
      ...(tasteTags !== undefined ? { tasteTags } : {}),
      ...(options.trigger !== undefined ? { trigger: options.trigger } : {}),
      ...(options.waitingMinutes !== undefined ? { waitingMinutes: options.waitingMinutes } : {}),
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
    const aiDraft = await this.buildDraft(agentPlan, draftContext);
    const aiValidation = await this.validateDraft(aiDraft, draftContext);
    const finalItems = aiValidation.valid
      ? aiValidation.items
      : await this.rebuildValidDraft(candidates, draftContext, aiValidation);

    const toStore: CreateItineraryItemDto[] = finalItems.map((item) => ({
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
      ...(item.memo ? { memo: item.memo } : {}),
    } as CreateItineraryItemDto));

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
    const waitingPadding = options.waitingMinutes ? Math.min(options.waitingMinutes, 90) : 0;
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
        if (order === 1 && waitingPadding > 0) {
          currentAt = new Date(currentAt.getTime() + waitingPadding * 60000);
        }
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

    let lastValidation = failedAiValidation;
    const attempts = Math.min(3, candidates.length);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const fallbackPlan = this.buildDeterministicPlan(
        this.rotate(candidates, attempt),
        context.dayCount,
        context.itemsPerDay,
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

  private buildPlaceName(name: string, trigger: GenerateOptions['trigger'], day: number, order: number): string {
    if (!trigger) return name;
    if (day === 1 && order >= 1) {
      return `${name} (${trigger} 대응)`;
    }
    return name;
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

    if (options.trigger === 'waiting') {
      return `${base}; ${agentEvidence}; ${cragEvidence}; 웨이팅 ${options.waitingMinutes ?? 0}분 반영해 실내/대기 친화 장소로 교체`;
    }
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
    const date = new Date(`${dateText}T00:00:00+09:00`);
    date.setDate(date.getDate() + offset);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
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
    const eta = transportMode === 'car'
      ? await this.routeHelper.getDrivingEta(from, to)
      : await this.routeHelper.getTransitEta(from, to);
    return Math.max(15, Math.ceil(eta.durationSec / 60));
  }

  private assertTripWindow(trip: TripEntity): void {
    if (trip.endDate < trip.startDate) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
  }
}
