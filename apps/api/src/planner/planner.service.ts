import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItineraryService } from '../itinerary/itinerary.service';
import { PreferencesService } from '../preferences/preferences.service';
import { WeatherHelper } from './helpers/weather.helper';
import { RouteHelper } from './helpers/route.helper';
import { PreferenceHelper } from './helpers/preference.helper';
import { ScheduleConstraint } from './helpers/schedule.constraint';
import { ConstraintEngine } from './constraint/constraint.engine';
import { TripEntity } from '../trips/trip.entity';
import type { CreateItineraryItemDto, ItineraryItemDto, PlaceDto, ReplanRequestDto, TasteTagDto } from '@tripick/types';

interface PlannerPlaceSeed extends PlaceDto {
  tags: string[];
}

interface GenerateOptions {
  trigger?: ReplanRequestDto['trigger'];
  waitingMinutes?: number;
  deviatedItemId?: string;
}

const PLACE_SEEDS: Record<string, PlannerPlaceSeed[]> = {
  seoul: [
    { id: 'seoul-1', name: '성수 서울숲', category: 'park', address: '서울 성동구 뚝섬로 273', coordinates: { lat: 37.5446, lng: 127.0375 }, openingHours: '08:00-21:00', tags: ['nature', 'healing', 'walk'] },
    { id: 'seoul-2', name: '성수 감도 카페', category: 'cafe', address: '서울 성동구 연무장길 45', coordinates: { lat: 37.5441, lng: 127.0541 }, openingHours: '10:00-22:00', tags: ['cafe', 'city', 'healing'] },
    { id: 'seoul-3', name: '을지로 한식 다이닝', category: 'restaurant', address: '서울 중구 수표로 48', coordinates: { lat: 37.5667, lng: 126.9913 }, openingHours: '11:00-21:00', tags: ['korean', 'cultural', 'city'] },
    { id: 'seoul-4', name: '국립중앙박물관', category: 'attraction', address: '서울 용산구 서빙고로 137', coordinates: { lat: 37.523, lng: 126.9804 }, openingHours: '10:00-18:00', tags: ['cultural', 'family', 'city'] },
    { id: 'seoul-5', name: '한강 노들섬', category: 'attraction', address: '서울 용산구 양녕로 445', coordinates: { lat: 37.5177, lng: 126.9574 }, openingHours: '09:00-22:00', tags: ['nature', 'romantic', 'city'] },
    { id: 'seoul-6', name: '북촌 골목 산책', category: 'attraction', address: '서울 종로구 계동길 37', coordinates: { lat: 37.5826, lng: 126.9831 }, openingHours: '09:00-18:00', tags: ['cultural', 'village', 'walk'] },
  ],
  busan: [
    { id: 'busan-1', name: '해운대 블루라인파크', category: 'attraction', address: '부산 해운대구 청사포로 116', coordinates: { lat: 35.1587, lng: 129.1758 }, openingHours: '09:00-19:00', tags: ['beach', 'adventure', 'nature'] },
    { id: 'busan-2', name: '광안리 브런치 카페', category: 'cafe', address: '부산 수영구 광안해변로 219', coordinates: { lat: 35.1532, lng: 129.1185 }, openingHours: '10:00-22:00', tags: ['cafe', 'beach', 'romantic'] },
    { id: 'busan-3', name: '기장 해산물 식당', category: 'restaurant', address: '부산 기장군 기장해안로 266', coordinates: { lat: 35.1906, lng: 129.2231 }, openingHours: '11:00-21:00', tags: ['korean', 'family', 'beach'] },
    { id: 'busan-4', name: '흰여울문화마을', category: 'attraction', address: '부산 영도구 영선동4가 605-3', coordinates: { lat: 35.078, lng: 129.0455 }, openingHours: '09:00-18:00', tags: ['village', 'healing', 'nature'] },
    { id: 'busan-5', name: '부산현대미술관', category: 'attraction', address: '부산 사하구 낙동남로 1191', coordinates: { lat: 35.1049, lng: 128.9668 }, openingHours: '10:00-18:00', tags: ['cultural', 'city', 'family'] },
    { id: 'busan-6', name: '송정 해변 산책', category: 'attraction', address: '부산 해운대구 송정해변로 50', coordinates: { lat: 35.1804, lng: 129.1998 }, openingHours: '08:00-21:00', tags: ['beach', 'healing', 'walk'] },
  ],
  jeju: [
    { id: 'jeju-1', name: '사려니숲길', category: 'attraction', address: '제주 제주시 조천읍 교래리 산137-1', coordinates: { lat: 33.4221, lng: 126.6426 }, openingHours: '09:00-17:00', tags: ['nature', 'healing', 'mountain'] },
    { id: 'jeju-2', name: '애월 오션뷰 카페', category: 'cafe', address: '제주 제주시 애월읍 애월북서길 56', coordinates: { lat: 33.4634, lng: 126.3098 }, openingHours: '10:00-21:00', tags: ['cafe', 'beach', 'romantic'] },
    { id: 'jeju-3', name: '제주 흑돼지 식당', category: 'restaurant', address: '제주 제주시 원노형로 41', coordinates: { lat: 33.4872, lng: 126.4815 }, openingHours: '11:00-22:00', tags: ['korean', 'family', 'city'] },
    { id: 'jeju-4', name: '성산일출봉', category: 'attraction', address: '제주 서귀포시 성산읍 일출로 284-12', coordinates: { lat: 33.4589, lng: 126.9425 }, openingHours: '07:00-20:00', tags: ['adventure', 'nature', 'mountain'] },
    { id: 'jeju-5', name: '제주 민속촌', category: 'attraction', address: '제주 서귀포시 표선면 민속해안로 631-34', coordinates: { lat: 33.3225, lng: 126.8425 }, openingHours: '09:00-18:00', tags: ['cultural', 'village', 'family'] },
    { id: 'jeju-6', name: '협재 해변 산책', category: 'attraction', address: '제주 제주시 한림읍 협재리 2497-1', coordinates: { lat: 33.3945, lng: 126.2395 }, openingHours: '08:00-21:00', tags: ['beach', 'healing', 'walk'] },
  ],
  default: [
    { id: 'default-1', name: '로컬 대표 전망 스팟', category: 'attraction', address: '도심 중심 관광지', coordinates: { lat: 37.5665, lng: 126.978 }, openingHours: '09:00-20:00', tags: ['city', 'healing'] },
    { id: 'default-2', name: '로컬 브런치 카페', category: 'cafe', address: '메인 스트리트 12', coordinates: { lat: 37.5659, lng: 126.9827 }, openingHours: '10:00-21:00', tags: ['cafe', 'city'] },
    { id: 'default-3', name: '로컬 시그니처 식당', category: 'restaurant', address: '맛집 골목 7', coordinates: { lat: 37.5644, lng: 126.977 }, openingHours: '11:00-21:00', tags: ['korean', 'family'] },
    { id: 'default-4', name: '로컬 문화 공간', category: 'attraction', address: '문화광장 2', coordinates: { lat: 37.5701, lng: 126.9769 }, openingHours: '10:00-18:00', tags: ['cultural', 'city'] },
    { id: 'default-5', name: '강변 산책 코스', category: 'attraction', address: '강변 산책로', coordinates: { lat: 37.5722, lng: 126.9911 }, openingHours: '08:00-22:00', tags: ['nature', 'walk'] },
    { id: 'default-6', name: '야간 디저트 바', category: 'restaurant', address: '야간상권 19', coordinates: { lat: 37.5692, lng: 126.9855 }, openingHours: '17:00-23:00', tags: ['romantic', 'city', 'cafe'] },
  ],
};

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(
    @InjectRepository(TripEntity)
    private readonly tripsRepo: Repository<TripEntity>,
    private readonly itineraryService: ItineraryService,
    private readonly preferencesService: PreferencesService,
    private readonly weatherHelper: WeatherHelper,
    private readonly routeHelper: RouteHelper,
    private readonly preferenceHelper: PreferenceHelper,
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
    });
  }

  private async buildAndStoreItinerary(trip: TripEntity, options: GenerateOptions): Promise<ItineraryItemDto[]> {
    this.assertTripWindow(trip);
    const preference = await this.preferencesService.findByUser(trip.userId);
    const tasteTags = preference?.tasteTags;
    const catalog = this.pickCatalog(trip.destination);
    const candidates = this.pickCandidates(catalog, tasteTags, options.trigger);
    const dayCount = this.getDayCount(trip.startDate, trip.endDate);
    const wakeTime = trip.wakeTime ?? '08:30';
    const sleepTime = trip.sleepTime ?? '22:00';
    const itemsPerDay = 4;
    const created: CreateItineraryItemDto[] = [];
    const waitingPadding = options.waitingMinutes ? Math.min(options.waitingMinutes, 90) : 0;

    for (let day = 1; day <= dayCount; day += 1) {
      const daySeeds = this.rotate(candidates, (day - 1) * 2).slice(0, itemsPerDay);
      let currentAt = this.makeDateTime(this.offsetDate(trip.startDate, day - 1), wakeTime);

      for (let order = 0; order < daySeeds.length; order += 1) {
        const seed = daySeeds[order]!;
        const durationMin = seed.category === 'restaurant' ? 80 : seed.category === 'cafe' ? 60 : 90;
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

        created.push({
          tripId: trip.id,
          day,
          order: order + 1,
          type: this.toItemType(seed.category),
          name: this.buildPlaceName(seed.name, options.trigger, day, order),
          address: seed.address,
          coordinates: seed.coordinates,
          scheduledAt: currentAt.toISOString(),
          durationMin,
          kakaoPlaceId: seed.kakaoPlaceId,
          openingHours: seed.openingHours,
          phoneNumber: seed.phone,
          imageUrl: seed.imageUrl,
          memo: this.buildMemo(seed, tasteTags, trip, options),
          travelTimeMin: travelTimeMin || undefined,
        } as CreateItineraryItemDto & Partial<ItineraryItemDto>);

        currentAt = new Date(currentAt.getTime() + durationMin * 60000);
      }
    }

    const forecast = catalog[0]
      ? await this.weatherHelper.getForecast(catalog[0].coordinates.lat, catalog[0].coordinates.lng, new Date(trip.startDate))
      : new Map();
    const weatherHint = this.weatherHelper.buildWeatherHint(forecast);

    const draft = created.map((item) => ({
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

    const bounded = this.scheduleConstraint.apply(draft, { wakeTime, sleepTime });
    const validated = await this.constraintEngine.validate(bounded, {
      wakeTime,
      sleepTime,
      transportMode: trip.transportMode,
    });

    if (!validated.valid) {
      this.logger.warn(
        `Generated best-effort itinerary for trip ${trip.id}: ${validated.issues.join('; ')}`,
      );
    }

    const toStore: CreateItineraryItemDto[] = validated.items.map((item) => ({
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
    this.logger.log(`Generated ${saved.length} itinerary items for trip ${trip.id}`);
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

  private pickCatalog(destination: string): PlannerPlaceSeed[] {
    const normalized = destination.toLowerCase();
    if (normalized.includes('서울') || normalized.includes('seoul')) return PLACE_SEEDS['seoul'] ?? PLACE_SEEDS['default']!;
    if (normalized.includes('부산') || normalized.includes('busan')) return PLACE_SEEDS['busan'] ?? PLACE_SEEDS['default']!;
    if (normalized.includes('제주') || normalized.includes('jeju')) return PLACE_SEEDS['jeju'] ?? PLACE_SEEDS['default']!;
    return PLACE_SEEDS['default']!;
  }

  private pickCandidates(
    catalog: PlannerPlaceSeed[],
    tasteTags?: TasteTagDto,
    trigger?: GenerateOptions['trigger'],
  ): PlannerPlaceSeed[] {
    const preferred = new Set<string>([
      ...(tasteTags?.food ?? []),
      ...(tasteTags?.mood ?? []),
      ...(tasteTags?.environment ?? []),
    ]);

    const scored = catalog
      .map((place) => ({
        place,
        score: place.tags.reduce((sum, tag) => sum + (preferred.has(tag) ? 3 : 0), 0),
      }))
      .sort((a, b) => b.score - a.score);

    const ordered = scored.map((entry) => entry.place);
    if (trigger === 'waiting') {
      return ordered.sort((a, b) => Number(a.category === 'cafe') - Number(b.category === 'cafe'));
    }
    if (trigger === 'manual' || trigger === 'deviation') {
      return ordered.reverse();
    }
    return ordered;
  }

  private buildPlaceName(name: string, trigger: GenerateOptions['trigger'], day: number, order: number): string {
    if (!trigger) return name;
    if (day === 1 && order >= 1) {
      return `${name} (${trigger} 대응)`;
    }
    return name;
  }

  private buildMemo(
    place: PlannerPlaceSeed,
    tasteTags: TasteTagDto | undefined,
    trip: TripEntity,
    options: GenerateOptions,
  ): string {
    const keywords = [
      ...(tasteTags?.food ?? []),
      ...(tasteTags?.mood ?? []),
      ...(tasteTags?.environment ?? []),
    ].filter((tag) => place.tags.includes(tag));

    const base = keywords.length > 0
      ? `선호 태그(${keywords.join(', ')}) 기준 추천`
      : `${trip.destination} 대표 동선에 맞춘 추천`;

    if (options.trigger === 'waiting') {
      return `${base}; 웨이팅 ${options.waitingMinutes ?? 0}분 반영해 실내/대기 친화 장소로 교체`;
    }
    if (options.trigger === 'manual') {
      return `${base}; 수동 재계획 요청 반영`;
    }
    if (options.trigger === 'deviation') {
      return `${base}; 이탈 상황에서 복귀 쉬운 순서로 재배치`;
    }
    return base;
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
