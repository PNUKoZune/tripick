import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FriendsService } from '../friends/friends.service';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { PreferencesService } from '../preferences/preferences.service';
import { TripMembersService } from '../trip-members/trip-members.service';
import { TripEntity } from '../trips/trip.entity';
import { TripsService } from '../trips/trips.service';
import { UserEntity } from '../users/user.entity';
import type {
  AddTripMemberRequestDto,
  CreateTripDto,
  CreateTripRequestDto,
  PlannerAlternativeDto,
  PlannerAlternativeResponseDto,
  PlannerCoordinationDto,
  PlannerCoordinationVoteRowDto,
  PlannerItineraryItemDto,
  PlannerMapMarkerDto,
  PlannerMemberDto,
  PlannerSwapRequestDto,
  PlannerSwapResponseDto,
  PlannerTripDto,
  PreferenceCoordinationDto,
  PreferenceVoteDto,
  TripMemberDto,
  TripSummaryDto,
  TripSummaryStatus,
} from '@tripick/types';

const LABELS: Record<string, string> = {
  korean: '한식·전통',
  japanese: '일식',
  western: '양식',
  chinese: '중식',
  vegan: '가벼운 식사',
  cafe: '카페',
  healing: '힐링',
  adventure: '액티비티',
  romantic: '감도 있는 코스',
  family: '부담 적은 동선',
  cultural: '문화·역사',
  nature: '자연',
  city: '도시',
  beach: '바다',
  mountain: '산·숲',
  village: '로컬 골목',
};

const TYPE_LABEL: Record<string, string> = {
  attraction: '관광',
  restaurant: '식사',
  cafe: '카페',
  accommodation: '숙소',
  transport: '이동',
};

@Injectable()
export class MainPlannerService {
  constructor(
    @InjectRepository(TripEntity)
    private readonly tripsRepo: Repository<TripEntity>,
    @InjectRepository(ItineraryItemEntity)
    private readonly itemsRepo: Repository<ItineraryItemEntity>,
    private readonly tripsService: TripsService,
    private readonly tripMembersService: TripMembersService,
    private readonly friendsService: FriendsService,
    private readonly preferencesService: PreferencesService,
  ) {}

  async listTrips(user: UserEntity): Promise<TripSummaryDto[]> {
    const trips = await this.tripsService.findByUser(user.id);
    return Promise.all(trips.map((trip) => this.toTripSummary(trip, user)));
  }

  async createTrip(user: UserEntity, dto: CreateTripRequestDto): Promise<TripSummaryDto> {
    this.assertCreateTrip(dto);
    const preference = await this.preferencesService.findByUser(user.id);
    const trip = await this.tripsService.create(user.id, {
      title: dto.title.trim(),
      destination: dto.destination.trim(),
      startDate: dto.startDate,
      endDate: dto.endDate,
      wakeTime: preference?.profile?.wakeTime ?? '08:00',
      sleepTime: preference?.profile?.sleepTime ?? '23:00',
      transportMode: this.resolveTransportMode(preference?.profile?.transportModes?.[0]),
      ...(dto.notes?.trim() ? { notes: dto.notes.trim() } : {}),
    } satisfies CreateTripDto);

    await this.addDraftMembers(trip.id, user.id, dto.members);
    return this.toTripSummary(trip, user);
  }

  async getTrip(user: UserEntity, tripId: string): Promise<PlannerTripDto> {
    const trip = await this.tripsService.findOne(tripId, user.id);
    const [members, items, preference] = await Promise.all([
      this.tripMembersService.findAll(tripId, user),
      this.findItems(tripId),
      this.preferencesService.findByUser(user.id),
    ]);
    return this.toPlannerTrip(trip, members, items, preference?.tasteTags);
  }

  async getCoordination(user: UserEntity, tripId: string): Promise<PlannerCoordinationDto> {
    const coordination = await this.tripMembersService.getCoordination(tripId, user);
    return this.toPlannerCoordination(coordination);
  }

  async addMember(
    user: UserEntity,
    tripId: string,
    dto: AddTripMemberRequestDto,
  ): Promise<PlannerMemberDto[]> {
    if (!dto?.friendId) {
      throw new BadRequestException('friendId 가 필요합니다.');
    }
    const friend = await this.friendsService.findAcceptedById(user.id, dto.friendId);
    await this.tripMembersService.createFromFriend(tripId, user.id, friend);
    return this.listPlannerMembers(user, tripId);
  }

  async removeMember(
    user: UserEntity,
    tripId: string,
    memberId: string,
  ): Promise<PlannerMemberDto[]> {
    await this.tripMembersService.remove(tripId, memberId, user.id);
    return this.listPlannerMembers(user, tripId);
  }

  async getAlternatives(
    user: UserEntity,
    tripId: string,
    itemId: string,
  ): Promise<PlannerAlternativeResponseDto> {
    await this.tripsService.findOne(tripId, user.id);
    const item = await this.findItem(tripId, itemId);
    const alternatives = this.buildAlternatives(item);
    const markers = [
      this.toMarker(item, 0, 'current'),
      ...alternatives.map((alternative, index) =>
        this.toAlternativeMarker(item, alternative, index + 1),
      ),
    ];

    return {
      itemId,
      itemName: item.name,
      waitingMinutes: item.type === 'restaurant' ? 15 : 0,
      radiusMeters: 900,
      realtime: false,
      alternatives,
      mapCenter: {
        lat: item.coordinates.lat,
        lng: item.coordinates.lng,
        level: 5,
      },
      mapMarkers: this.withNormalizedMarkerPositions(markers),
    };
  }

  async swap(
    user: UserEntity,
    tripId: string,
    dto: PlannerSwapRequestDto,
  ): Promise<PlannerSwapResponseDto> {
    await this.tripsService.findOne(tripId, user.id);
    const item = await this.findItem(tripId, dto.itemId);
    const alternative = this.buildAlternatives(item).find((alt) => alt.id === dto.alternativeId);
    if (!alternative) {
      throw new NotFoundException('alternative not found');
    }

    const marker = this.toAlternativeMarker(item, alternative, 1);
    item.name = alternative.name;
    item.address = `${alternative.name} 인근`;
    item.coordinates = { lat: marker.lat, lng: marker.lng };
    await this.itemsRepo.save(item);

    return {
      tripId,
      swappedItemId: dto.itemId,
      newItemName: alternative.name,
    };
  }

  private async listPlannerMembers(user: UserEntity, tripId: string): Promise<PlannerMemberDto[]> {
    const members = await this.tripMembersService.findAll(tripId, user);
    return members.map((member) => this.toPlannerMember(member));
  }

  private async addDraftMembers(
    tripId: string,
    userId: string,
    members: PlannerMemberDto[],
  ): Promise<void> {
    const friendIds = members
      .map((member) => member.friendId ?? this.friendIdFromDraftMemberId(member.id))
      .filter((friendId): friendId is string => Boolean(friendId));

    for (const friendId of [...new Set(friendIds)]) {
      const friend = await this.friendsService.findAcceptedById(userId, friendId);
      await this.tripMembersService.createFromFriend(tripId, userId, friend).catch((error) => {
        if (error instanceof BadRequestException) {
          return null;
        }
        throw error;
      });
    }
  }

  private assertCreateTrip(dto: CreateTripRequestDto): void {
    if (!dto?.title?.trim()) {
      throw new BadRequestException('제목을 입력해주세요.');
    }
    if (!dto.destination?.trim()) {
      throw new BadRequestException('여행 지역을 입력해주세요.');
    }
    if (!dto.startDate || !dto.endDate) {
      throw new BadRequestException('여행 기간을 선택해주세요.');
    }
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException('시작일은 종료일보다 빨라야 합니다.');
    }
    if (!dto.startTime || !dto.endTime) {
      throw new BadRequestException('출발/도착 시각을 입력해주세요.');
    }
    if (dto.startDate === dto.endDate && dto.startTime >= dto.endTime) {
      throw new BadRequestException('도착 시각은 출발 시각보다 늦어야 합니다.');
    }
  }

  private async toTripSummary(trip: TripEntity, user: UserEntity): Promise<TripSummaryDto> {
    const [members, itemCount, firstItems] = await Promise.all([
      this.tripMembersService.findAll(trip.id, user),
      this.itemsRepo.count({ where: { tripId: trip.id } }),
      this.itemsRepo.find({
        where: { tripId: trip.id },
        order: { day: 'ASC', order: 'ASC' },
        take: 2,
      }),
    ]);

    return {
      id: trip.id,
      title: trip.title,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      durationLabel: this.durationLabel(trip.startDate, trip.endDate),
      status: this.summaryStatus(trip),
      statusLabel: this.summaryStatusLabel(this.summaryStatus(trip)),
      members: members.map((member) => this.toPlannerMember(member)),
      coverEmoji: this.coverEmoji(trip.destination),
      highlight: trip.notes?.trim() || this.highlightFromItems(firstItems, trip.destination),
      itemCount,
      hasDetail: true,
    };
  }

  private toPlannerTrip(
    trip: TripEntity,
    members: TripMemberDto[],
    items: ItineraryItemEntity[],
    tasteTags?: PlannerTripDto['meta']['tasteTags'],
  ): PlannerTripDto {
    const days = this.buildDays(trip.startDate, trip.endDate);
    const markers = this.withNormalizedMarkerPositions(
      items.map((item, index) => this.toMarker(item, index, index === 0 ? 'current' : 'primary')),
    );
    const center = this.mapCenter(items, trip.destination);
    const totalTravelMin = items.reduce((sum, item) => sum + (item.travelTimeMin ?? 0), 0);

    return {
      id: trip.id,
      title: trip.title,
      members: members.map((member) => this.toPlannerMember(member)),
      searchPlaceholder: `${trip.destination} 여행 검색...`,
      mapCenter: center,
      mapMarkers: markers,
      days,
      items: items.map((item) => this.toPlannerItem(item)),
      meta: {
        startDate: trip.startDate,
        endDate: trip.endDate,
        durationLabel: this.durationLabel(trip.startDate, trip.endDate),
        transportLabel: this.transportLabel(trip.transportMode),
        wakeTime: trip.wakeTime ?? '08:00',
        sleepTime: trip.sleepTime ?? '23:00',
        tasteTags: tasteTags ?? { food: [], mood: [], environment: [] },
        stats: {
          totalItems: items.length,
          waitingCount: items.filter((item) => item.type === 'restaurant').length,
          estimatedTravelKm: Math.round((totalTravelMin / 12) * 10) / 10,
        },
        weather: days.map((day) => ({
          day: day.day,
          label: `${day.dateLabel} 날씨 확인 전`,
          emoji: '☁️',
          tempLabel: '-',
        })),
      },
    };
  }

  private toPlannerCoordination(coordination: PreferenceCoordinationDto): PlannerCoordinationDto {
    const initialByName = new Map(
      coordination.members.map((member) => [member.nickname, this.memberInitial(member)]),
    );
    return {
      tripId: coordination.tripId,
      members: coordination.members.map((member) => ({
        id: member.id,
        initial: this.memberInitial(member),
        color: member.color,
        friendId: member.friendId ?? null,
        nickname: member.nickname,
        role: member.role,
        tasteLabels: this.memberTasteLabels(member),
      })),
      consensus: {
        food: this.toPlannerVotes(coordination.consensus.food, initialByName),
        mood: this.toPlannerVotes(coordination.consensus.mood, initialByName),
        environment: this.toPlannerVotes(coordination.consensus.environment, initialByName),
      },
      recommendation: coordination.recommendation,
    };
  }

  private toPlannerVotes(
    votes: PreferenceVoteDto[],
    initialByName: Map<string, string>,
  ): PlannerCoordinationVoteRowDto[] {
    return votes.map((vote) => ({
      key: vote.key,
      label: vote.label,
      count: vote.count,
      voters: vote.memberNames.map((name) => initialByName.get(name) ?? this.initialFromName(name)),
    }));
  }

  private toPlannerMember(member: TripMemberDto): PlannerMemberDto {
    return {
      id: member.id,
      initial: this.memberInitial(member),
      color: member.color,
      friendId: member.friendId ?? null,
      nickname: member.nickname,
      role: member.role,
    };
  }

  private toPlannerItem(item: ItineraryItemEntity): PlannerItineraryItemDto {
    return {
      id: item.id,
      day: item.day,
      scheduledAt: this.timeLabel(item.scheduledAt),
      type: item.type === 'accommodation' ? 'attraction' : item.type,
      typeLabel: TYPE_LABEL[item.type] ?? '일정',
      name: item.name,
      durationLabel: item.travelTimeMin
        ? `이동 ${item.travelTimeMin}분 · 체류 ${item.durationMin}분`
        : `체류 ${item.durationMin}분`,
      hasWaiting: item.type === 'restaurant',
      ...(item.type === 'restaurant' ? { waitingMinutes: 15 } : {}),
    };
  }

  private memberTasteLabels(member: TripMemberDto): string[] {
    return [
      ...member.preferenceTags.food,
      ...member.preferenceTags.mood,
      ...member.preferenceTags.environment,
    ]
      .slice(0, 4)
      .map((tag) => LABELS[tag] ?? tag);
  }

  private memberInitial(member: TripMemberDto): string {
    return member.role === 'owner' ? '나' : this.initialFromName(member.nickname);
  }

  private initialFromName(name: string): string {
    return (name.trim()[0] ?? '?').toUpperCase();
  }

  private friendIdFromDraftMemberId(memberId: string): string | null {
    return memberId.startsWith('tm-') ? memberId.slice(3) : null;
  }

  private async findItems(tripId: string): Promise<ItineraryItemEntity[]> {
    return this.itemsRepo.find({
      where: { tripId },
      order: { day: 'ASC', order: 'ASC' },
    });
  }

  private async findItem(tripId: string, itemId: string): Promise<ItineraryItemEntity> {
    const item = await this.itemsRepo.findOneBy({ id: itemId, tripId });
    if (!item) {
      throw new NotFoundException('itinerary item not found');
    }
    return item;
  }

  private buildAlternatives(item: ItineraryItemEntity): PlannerAlternativeDto[] {
    const baseNames =
      item.type === 'restaurant'
        ? ['로컬 한식당', '웨이팅 적은 맛집', '근처 시그니처 식당']
        : item.type === 'cafe'
          ? ['조용한 로컬 카페', '뷰 좋은 카페', '디저트 카페']
          : ['근처 산책 스팟', '실내 문화 공간', '사진 찍기 좋은 장소'];

    return baseNames.map((name, index) => ({
      id: `${item.id}:alt-${index + 1}`,
      categoryEmoji: item.type === 'restaurant' ? '🍚' : item.type === 'cafe' ? '☕' : '📍',
      categoryTone: index === 0 ? 'primary' : index === 1 ? 'success' : 'neutral',
      name: `${item.name} 대안 ${name}`,
      walkLabel: `도보 ${8 + index * 4}분`,
      waitLabel: item.type === 'restaurant' ? `대기 ${Math.max(0, 10 - index * 5)}분` : '바로 입장',
      rating: Math.round((4.6 - index * 0.1) * 10) / 10,
      mapHref: `https://map.kakao.com/?q=${encodeURIComponent(`${item.name} ${name}`)}`,
      badge: index === 0 ? '추천' : index === 1 ? '빠름' : '근처',
      badgeTone: index === 0 ? 'recommend' : index === 1 ? 'local' : 'urgent',
    }));
  }

  private toMarker(
    item: ItineraryItemEntity,
    index: number,
    variant: PlannerMapMarkerDto['variant'],
  ): PlannerMapMarkerDto {
    return {
      id: `marker-${item.id}`,
      itemId: item.id,
      label: item.name,
      order: index + 1,
      lat: item.coordinates.lat,
      lng: item.coordinates.lng,
      x: 0.5,
      y: 0.5,
      variant,
    };
  }

  private toAlternativeMarker(
    item: ItineraryItemEntity,
    alternative: PlannerAlternativeDto,
    index: number,
  ): PlannerMapMarkerDto {
    const latOffset = (index % 2 === 0 ? -1 : 1) * (0.003 + index * 0.001);
    const lngOffset = (index % 2 === 0 ? 1 : -1) * (0.0035 + index * 0.001);
    return {
      id: `marker-${alternative.id}`,
      label: alternative.name,
      order: index + 1,
      lat: item.coordinates.lat + latOffset,
      lng: item.coordinates.lng + lngOffset,
      x: 0.5,
      y: 0.5,
      variant: 'alternative',
    };
  }

  private withNormalizedMarkerPositions(markers: PlannerMapMarkerDto[]): PlannerMapMarkerDto[] {
    if (markers.length === 0) {
      return [];
    }
    const latValues = markers.map((marker) => marker.lat);
    const lngValues = markers.map((marker) => marker.lng);
    const minLat = Math.min(...latValues);
    const maxLat = Math.max(...latValues);
    const minLng = Math.min(...lngValues);
    const maxLng = Math.max(...lngValues);
    const latRange = maxLat - minLat || 1;
    const lngRange = maxLng - minLng || 1;

    return markers.map((marker) => ({
      ...marker,
      x: 0.15 + ((marker.lng - minLng) / lngRange) * 0.7,
      y: 0.15 + (1 - (marker.lat - minLat) / latRange) * 0.7,
    }));
  }

  private mapCenter(
    items: ItineraryItemEntity[],
    destination: string,
  ): PlannerTripDto['mapCenter'] {
    if (items.length === 0) {
      return this.fallbackCenter(destination);
    }
    const total = items.reduce(
      (sum, item) => ({
        lat: sum.lat + item.coordinates.lat,
        lng: sum.lng + item.coordinates.lng,
      }),
      { lat: 0, lng: 0 },
    );
    return {
      lat: total.lat / items.length,
      lng: total.lng / items.length,
      level: items.length > 4 ? 7 : 6,
    };
  }

  private fallbackCenter(destination: string): PlannerTripDto['mapCenter'] {
    if (destination.includes('부산')) return { lat: 35.1796, lng: 129.0756, level: 7 };
    if (destination.includes('제주')) return { lat: 33.4996, lng: 126.5312, level: 8 };
    if (destination.includes('경주')) return { lat: 35.8562, lng: 129.2247, level: 7 };
    return { lat: 37.5665, lng: 126.978, level: 7 };
  }

  private buildDays(startDate: string, endDate: string) {
    const start = new Date(`${startDate}T00:00:00+09:00`);
    const end = new Date(`${endDate}T00:00:00+09:00`);
    const diff = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
    return Array.from({ length: diff + 1 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const iso = this.isoDate(date);
      return {
        day: index + 1,
        label: `${index + 1}일차`,
        dateLabel: this.dateLabel(iso),
      };
    });
  }

  private summaryStatus(trip: TripEntity): TripSummaryStatus {
    if (trip.status === 'draft' || trip.status === 'cancelled') return 'draft';
    if (trip.status === 'completed') return 'done';

    const today = this.isoDate(new Date());
    if (today < trip.startDate) return 'upcoming';
    if (today > trip.endDate) return 'done';
    return 'ongoing';
  }

  private summaryStatusLabel(status: TripSummaryStatus): string {
    return {
      draft: '초안',
      upcoming: '곧 출발',
      ongoing: '진행 중',
      done: '다녀옴',
    }[status];
  }

  private durationLabel(startDate: string, endDate: string): string {
    const start = new Date(`${startDate}T00:00:00+09:00`);
    const end = new Date(`${endDate}T00:00:00+09:00`);
    const nights = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
    const head = nights === 0 ? '당일치기' : `${nights}박 ${nights + 1}일`;
    return `${head} · ${this.dateLabel(startDate)} ~ ${this.dateLabel(endDate)}`;
  }

  private dateLabel(iso: string): string {
    const date = new Date(`${iso}T00:00:00+09:00`);
    const dow = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()] ?? '';
    return `${date.getMonth() + 1}/${date.getDate()} ${dow}`;
  }

  private timeLabel(date: Date): string {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  private isoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private transportLabel(mode: TripEntity['transportMode']): string {
    return { walk: '도보 중심', transit: '대중교통', car: '차량 이동' }[mode];
  }

  private resolveTransportMode(mode?: string): TripEntity['transportMode'] {
    if (mode === 'walk') return 'walk';
    if (mode === 'car' || mode === 'rental_car') return 'car';
    return 'transit';
  }

  private coverEmoji(destination: string): string {
    if (destination.includes('부산')) return '🌊';
    if (destination.includes('제주')) return '🌴';
    if (destination.includes('강릉')) return '☕';
    if (destination.includes('경주')) return '🏛️';
    if (destination.includes('서울')) return '🏙️';
    return '🧳';
  }

  private highlightFromItems(items: ItineraryItemEntity[], destination: string): string {
    if (items.length === 0) {
      return `${destination} 일정 생성 준비`;
    }
    return items.map((item) => item.name).join(' · ');
  }
}
