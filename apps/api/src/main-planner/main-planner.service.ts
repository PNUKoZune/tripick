import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import axios from 'axios';
import { FriendsService } from '../friends/friends.service';
import { InboxService } from '../inbox/inbox.service';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { PreferencesService } from '../preferences/preferences.service';
import { TripMembersService } from '../trip-members/trip-members.service';
import { TripEntity } from '../trips/trip.entity';
import { TripsService } from '../trips/trips.service';
import { UserEntity } from '../users/user.entity';
import { WeatherHelper } from '../planner/helpers/weather.helper';
import { RouteHelper } from '../planner/helpers/route.helper';
import { KakaoLocalService } from '../planner/retrieval/kakao-local.service';
import { PlaceRetrievalService } from '../planner/retrieval/place-retrieval.service';
import type { CandidatePlace, RawPlaceCandidate } from '../planner/retrieval/types';
import type { ParsedForecast } from '@tripick/utils';
import type {
  AddTripMemberRequestDto,
  CreateTripDto,
  CreateTripRequestDto,
  PlannerAddItemRequestDto,
  PlannerReorderItemsRequestDto,
  PlannerUpdateItemRequestDto,
  PlannerAlternativeDto,
  PlannerAlternativeResponseDto,
  PlannerCoordinationDto,
  PlannerCoordinationVoteRowDto,
  PlannerItemType,
  PlannerItineraryItemDto,
  PlannerMapMarkerDto,
  PlannerMemberDto,
  PlannerResolvePlaceResponseDto,
  PlannerSwapPlaceDto,
  PlannerSwapRequestDto,
  PlannerSwapResponseDto,
  PlannerTripDto,
  PlannerTripProgressDto,
  SharedItineraryDto,
  TripShareResponseDto,
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
    private readonly inboxService: InboxService,
    private readonly weatherHelper: WeatherHelper,
    private readonly kakaoLocal: KakaoLocalService,
    private readonly placeRetrieval: PlaceRetrievalService,
    private readonly routeHelper: RouteHelper,
  ) {}

  async listTrips(user: UserEntity): Promise<TripSummaryDto[]> {
    const trips = await this.tripsService.findVisible(user.id);
    return Promise.all(trips.map((trip) => this.toTripSummary(trip, user)));
  }

  async createTrip(user: UserEntity, dto: CreateTripRequestDto): Promise<TripSummaryDto> {
    this.assertCreateTrip(dto);
    const preference = await this.preferencesService.findByUser(user.id);
    const notes = this.composeCreateTripNotes(dto);
    const trip = await this.tripsService.create(user.id, {
      title: dto.title.trim(),
      destination: dto.destination.trim(),
      startDate: dto.startDate,
      endDate: dto.endDate,
      wakeTime: preference?.profile?.wakeTime ?? '08:00',
      sleepTime: preference?.profile?.sleepTime ?? '23:00',
      transportMode:
        dto.transportMode ?? this.resolveTransportMode(preference?.profile?.transportModes?.[0]),
      ...(notes ? { notes } : {}),
    } satisfies CreateTripDto);

    await this.addDraftMembers(trip.id, user.id, dto.members);
    return this.toTripSummary(trip, user);
  }

  async getTrip(user: UserEntity, tripId: string): Promise<PlannerTripDto> {
    const trip = await this.tripsService.findOneForViewer(tripId, user.id);
    const [members, items, preference] = await Promise.all([
      this.tripMembersService.findAll(tripId, user),
      this.findItems(tripId),
      this.preferencesService.findByUser(user.id),
    ]);
    return this.toPlannerTrip(trip, members, items, preference?.tasteTags, trip.userId === user.id);
  }

  /** 현재 공유 상태 조회 (owner) */
  async getShareStatus(user: UserEntity, tripId: string): Promise<{ token: string | null }> {
    const trip = await this.tripsService.findOne(tripId, user.id);
    return { token: trip.shareToken };
  }

  /** 공유 링크 활성화 (owner). 이미 있으면 기존 토큰을 그대로 반환한다. */
  async enableShare(user: UserEntity, tripId: string): Promise<TripShareResponseDto> {
    const trip = await this.tripsService.findOne(tripId, user.id);
    if (!trip.shareToken) {
      trip.shareToken = randomBytes(12).toString('base64url');
      await this.tripsRepo.save(trip);
    }
    return { token: trip.shareToken };
  }

  /** 공유 링크 비활성화 (owner) */
  async disableShare(user: UserEntity, tripId: string): Promise<void> {
    const trip = await this.tripsService.findOne(tripId, user.id);
    if (trip.shareToken) {
      trip.shareToken = null;
      await this.tripsRepo.save(trip);
    }
  }

  /** 공개 공유 토큰으로 읽기 전용 일정 조회 (인증 불필요) */
  async getSharedItinerary(token: string): Promise<SharedItineraryDto> {
    if (!token?.trim()) throw new NotFoundException('공유된 일정을 찾을 수 없어요.');
    const trip = await this.tripsRepo.findOneBy({ shareToken: token });
    if (!trip) throw new NotFoundException('공유된 일정을 찾을 수 없어요.');

    const [items, memberCount] = await Promise.all([
      this.findItems(trip.id),
      this.tripMembersService.countMembers(trip.id),
    ]);
    const days = this.buildDays(trip.startDate, trip.endDate);
    const markers = this.withNormalizedMarkerPositions(
      items.map((item, index) => this.toMarker(item, index, index === 0 ? 'current' : 'primary')),
    );

    return {
      title: trip.title,
      destination: trip.destination,
      durationLabel: this.durationLabel(trip.startDate, trip.endDate),
      transportLabel: this.transportLabel(trip.transportMode),
      memberCount,
      startDate: trip.startDate,
      endDate: trip.endDate,
      days,
      items: items.map((item) => this.toPlannerItem(item)),
      mapCenter: this.mapCenter(items, trip.destination),
      mapMarkers: markers,
    };
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
    const member = await this.tripMembersService.createFromFriend(tripId, user.id, friend);
    if (member.status === 'pending' && member.userId) {
      const trip = await this.tripsService.findOne(tripId, user.id);
      await this.inboxService.create({
        userId: member.userId,
        category: 'trip_invite',
        title: `${user.nickname} 님의 여행 초대`,
        body: `"${trip.title}" (${trip.destination}, ${trip.startDate} ~ ${trip.endDate})에 함께 떠나요!`,
        payload: { tripId, tripMemberId: member.id, inviterNickname: user.nickname },
      });
    }
    return this.listPlannerMembers(user, tripId);
  }

  async acceptInvite(
    user: UserEntity,
    tripId: string,
    memberId: string,
  ): Promise<PlannerMemberDto> {
    const member = await this.tripMembersService.acceptInvite(tripId, memberId, user);
    const trip = await this.tripsService.findOneForViewer(tripId, user.id);
    if (trip.userId !== user.id) {
      await this.inboxService.create({
        userId: trip.userId,
        category: 'general',
        title: `${user.nickname} 님이 초대를 수락했어요`,
        body: `"${trip.title}" 여행 멤버로 합류했습니다.`,
        payload: { tripId },
      });
    }
    return this.toPlannerMember(member);
  }

  async rejectInvite(user: UserEntity, tripId: string, memberId: string): Promise<void> {
    const trip = await this.tripsRepo.findOneBy({ id: tripId });
    await this.tripMembersService.rejectInvite(tripId, memberId, user);
    if (trip && trip.userId !== user.id) {
      await this.inboxService.create({
        userId: trip.userId,
        category: 'general',
        title: `${user.nickname} 님이 초대를 거절했어요`,
        body: `"${trip.title}" 여행 초대가 거절되었습니다.`,
        payload: { tripId },
      });
    }
  }

  async removeMember(
    user: UserEntity,
    tripId: string,
    memberId: string,
  ): Promise<PlannerMemberDto[]> {
    await this.tripMembersService.remove(tripId, memberId, user.id);
    return this.listPlannerMembers(user, tripId);
  }

  private static readonly ALTERNATIVE_RADIUS_M = 1200;

  async getAlternatives(
    user: UserEntity,
    tripId: string,
    itemId: string,
    note?: string,
  ): Promise<PlannerAlternativeResponseDto> {
    const trip = await this.tripsService.findOne(tripId, user.id);
    const item = await this.findItem(tripId, itemId);
    const trimmedNote = note?.trim() || undefined;

    // 기본 추천 → CRAG/임베딩(취향 개인화). note 가 있으면 그 조건을 검색에 반영(항목 스코프).
    let alternatives = await this.buildRecommendedAlternatives(trip, item, trimmedNote);
    const realCount = alternatives.length;

    // 기본 추천은 최소 3개가 되도록 mock 후보로 보충 (오프라인/키 미설정 대비).
    // note(사용자 조건 검색)일 때는 보충하지 않아 "결과 없음"을 그대로 노출한다.
    if (!trimmedNote && realCount < 3) {
      const filler = this.buildAlternatives(item)
        .slice(0, 3 - realCount)
        .map((alt, index) => ({ ...alt, id: `${item.id}:fill-${index + 1}` }));
      alternatives = [...alternatives, ...filler].slice(0, 5);
    }

    const markers = [
      this.toMarker(item, 0, 'current'),
      ...alternatives.map((alternative, index) => this.toAlternativeMarker(alternative, index + 1)),
    ];

    return {
      itemId,
      itemName: item.name,
      waitingMinutes: item.type === 'restaurant' ? 15 : 0,
      realtime: realCount > 0,
      alternatives,
      mapCenter: {
        lat: item.coordinates.lat,
        lng: item.coordinates.lng,
        level: 5,
      },
      mapMarkers: this.withNormalizedMarkerPositions(markers),
    };
  }

  /**
   * 사용자가 입력한 장소 이름(지도 링크도 허용)을 카카오 Local 로 실제 장소 1곳으로 해석한다.
   * 프론트는 이 후보를 지도에 띄워 "이 장소가 맞나요?" 확인을 받은 뒤 swap 으로 확정한다.
   */
  async resolvePlace(
    user: UserEntity,
    tripId: string,
    itemId: string,
    query: string,
  ): Promise<PlannerResolvePlaceResponseDto> {
    await this.tripsService.findOne(tripId, user.id);
    const item = await this.findItem(tripId, itemId);

    const keyword = await this.extractSearchKeyword(query);
    if (!keyword) {
      throw new BadRequestException('장소 이름을 입력해 주세요.');
    }

    // P3-8: 상위 후보 몇 곳을 돌려줘 사용자가 맞는 곳을 고르게 한다
    const results = await this.kakaoLocal.searchByText(
      keyword,
      3,
      item.coordinates,
      MainPlannerService.ALTERNATIVE_RADIUS_M * 8,
    );
    if (results.length === 0) {
      throw new NotFoundException(`"${keyword}" 장소를 찾지 못했어요. 다른 이름으로 시도해 주세요.`);
    }

    const alternatives = results.map((place) => this.toRealAlternative(item, place));
    return {
      alternatives,
      mapMarkers: alternatives.map((alternative, index) =>
        this.toAlternativeMarker(alternative, index + 1),
      ),
    };
  }

  async swap(
    user: UserEntity,
    tripId: string,
    dto: PlannerSwapRequestDto,
  ): Promise<PlannerSwapResponseDto> {
    const trip = await this.tripsService.findOne(tripId, user.id);
    const item = await this.findItem(tripId, dto.itemId);

    const place = dto.place;
    const previousName = item.name;
    // P3-10: 되돌리기용으로 바뀌기 직전 장소를 보관
    const previousPlace: PlannerSwapPlaceDto = {
      name: item.name,
      category: this.toPlannerItemType(item.type),
      address: item.address,
      lat: item.coordinates.lat,
      lng: item.coordinates.lng,
      ...(item.kakaoPlaceId ? { kakaoPlaceId: item.kakaoPlaceId } : {}),
    };
    item.name = place.name;
    item.address = place.address?.trim() || `${place.name} 인근`;
    item.coordinates = { lat: place.lat, lng: place.lng };
    // 새 장소의 카카오 ID 로 교체(없으면 이전 ID 를 남기지 않도록 비운다)
    (item as { kakaoPlaceId?: string | null }).kakaoPlaceId = place.kakaoPlaceId ?? null;
    if (place.category) {
      // P1-2: 카테고리도 함께 반영해 라벨·이모지·웨이팅 표시가 어긋나지 않게 한다
      item.type = place.category;
    }

    // P1-1: 앞/뒤 항목과의 이동시간을 다시 계산하고 실현가능성(시간 여유)을 검증한다
    const dayItems = (await this.itemsRepo.find({ where: { tripId, day: item.day } })).sort(
      (a, b) => a.order - b.order,
    );
    const idx = dayItems.findIndex((entry) => entry.id === item.id);
    const prev = idx > 0 ? dayItems[idx - 1] : null;
    const next = idx >= 0 && idx < dayItems.length - 1 ? dayItems[idx + 1] : null;
    const warnings: string[] = [];

    if (prev) {
      const inbound = await this.travelMinutes(
        trip,
        prev.coordinates,
        item.coordinates,
        this.departureFrom(prev),
      );
      item.travelTimeMin = inbound;
      this.pushGapWarning(warnings, prev, item, inbound);
    }
    await this.itemsRepo.save(item);

    if (next) {
      const outbound = await this.travelMinutes(
        trip,
        item.coordinates,
        next.coordinates,
        this.departureFrom(item),
      );
      next.travelTimeMin = outbound;
      await this.itemsRepo.save(next);
      this.pushGapWarning(warnings, item, next, outbound);
    }

    await this.inboxService.create({
      userId: user.id,
      category: 'replan_ready',
      title: '대안 일정 반영 완료',
      body: `"${previousName}" 일정이 "${place.name}"(으)로 바뀌었어요.`,
      payload: { tripId, itemId: dto.itemId },
    });

    return {
      tripId,
      swappedItemId: dto.itemId,
      newItemName: place.name,
      previousPlace,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /** 일정 항목 신규 추가 (해당 일차 끝에 붙이고 이동시간 재계산) */
  async addItem(
    user: UserEntity,
    tripId: string,
    dto: PlannerAddItemRequestDto,
  ): Promise<PlannerItineraryItemDto> {
    const trip = await this.tripsService.findOne(tripId, user.id);
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('장소 이름을 입력해 주세요.');
    if (!Number.isInteger(dto.day) || dto.day < 1) {
      throw new BadRequestException('유효한 일차가 아닙니다.');
    }

    const dayItems = await this.itemsRepo.find({ where: { tripId, day: dto.day } });
    const maxOrder = dayItems.reduce((max, entry) => Math.max(max, entry.order), 0);
    const fallback =
      dayItems[dayItems.length - 1]?.coordinates ??
      (await this.itemsRepo.findOne({ where: { tripId }, order: { day: 'ASC', order: 'ASC' } }))
        ?.coordinates ??
      MainPlannerService.DEFAULT_COORDINATES;

    const item = this.itemsRepo.create({
      tripId,
      day: dto.day,
      order: maxOrder + 1,
      type: dto.type ?? 'attraction',
      name,
      address: dto.address?.trim() || `${name} 인근`,
      coordinates:
        dto.lat !== undefined && dto.lng !== undefined
          ? { lat: dto.lat, lng: dto.lng }
          : fallback,
      scheduledAt: this.combineScheduledAt(this.dayBaseDate(trip, dto.day), dto.scheduledAt),
      durationMin: dto.durationMin ?? 60,
      ...(dto.memo?.trim() ? { memo: dto.memo.trim() } : {}),
      ...(dto.kakaoPlaceId?.trim() ? { kakaoPlaceId: dto.kakaoPlaceId.trim() } : {}),
    });
    const saved = await this.itemsRepo.save(item);
    await this.recomputeDayTravelTimes(trip, dto.day);
    return this.toPlannerItem(await this.findItem(tripId, saved.id));
  }

  /** 일정 항목 부분 수정 (시간·메모·이름·체류시간) */
  async updateItem(
    user: UserEntity,
    tripId: string,
    itemId: string,
    dto: PlannerUpdateItemRequestDto,
  ): Promise<PlannerItineraryItemDto> {
    await this.tripsService.findOne(tripId, user.id);
    const item = await this.findItem(tripId, itemId);

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('장소 이름은 비울 수 없어요.');
      item.name = name;
    }
    if (dto.scheduledAt !== undefined) {
      item.scheduledAt = this.combineScheduledAt(this.kstDateString(item.scheduledAt), dto.scheduledAt);
    }
    if (dto.durationMin !== undefined) {
      if (!Number.isInteger(dto.durationMin) || dto.durationMin < 0) {
        throw new BadRequestException('체류 시간이 올바르지 않습니다.');
      }
      item.durationMin = dto.durationMin;
    }
    if (dto.memo !== undefined) {
      (item as { memo?: string | null }).memo = dto.memo.trim() || null;
    }
    await this.itemsRepo.save(item);
    return this.toPlannerItem(await this.findItem(tripId, itemId));
  }

  /** 일정 항목 삭제 (남은 항목 순서 재정렬 + 이동시간 재계산) */
  async deleteItem(user: UserEntity, tripId: string, itemId: string): Promise<void> {
    const trip = await this.tripsService.findOne(tripId, user.id);
    const item = await this.findItem(tripId, itemId);
    const day = item.day;
    await this.itemsRepo.remove(item);
    await this.resequenceDay(tripId, day);
    await this.recomputeDayTravelTimes(trip, day);
  }

  /** 일정 항목 순서 변경 (드래그&드롭). 시간 슬롯은 유지하고 장소만 재배치한다. */
  async reorderItems(
    user: UserEntity,
    tripId: string,
    dto: PlannerReorderItemsRequestDto,
  ): Promise<void> {
    const trip = await this.tripsService.findOne(tripId, user.id);
    const dayItems = await this.itemsRepo.find({ where: { tripId, day: dto.day } });
    const byId = new Map(dayItems.map((entry) => [entry.id, entry]));
    if (
      dto.orderedItemIds.length !== dayItems.length ||
      !dto.orderedItemIds.every((id) => byId.has(id))
    ) {
      throw new BadRequestException('순서 정보가 현재 일정과 일치하지 않습니다.');
    }

    // 기존 시작 시간을 시간순으로 모아 새 위치에 그대로 배정 (타임라인이 오름차순 유지)
    const slotTimes = dayItems
      .map((entry) => entry.scheduledAt)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const reordered = dto.orderedItemIds.map((id, index) => {
      const entry = byId.get(id)!;
      entry.order = index + 1;
      entry.scheduledAt = slotTimes[index]!;
      return entry;
    });
    await this.itemsRepo.save(reordered);
    await this.recomputeDayTravelTimes(trip, dto.day);
  }

  private static readonly DEFAULT_COORDINATES = { lat: 37.5665, lng: 126.978 };

  /** 해당 일차 항목의 order 를 1..n 으로 다시 매긴다. */
  private async resequenceDay(tripId: string, day: number): Promise<void> {
    const items = (await this.itemsRepo.find({ where: { tripId, day } })).sort(
      (a, b) => a.order - b.order,
    );
    items.forEach((entry, index) => {
      entry.order = index + 1;
    });
    if (items.length > 0) await this.itemsRepo.save(items);
  }

  /** 해당 일차 항목의 이동시간(travelTimeMin)을 순서대로 다시 계산한다. */
  private async recomputeDayTravelTimes(trip: TripEntity, day: number): Promise<void> {
    const items = (await this.itemsRepo.find({ where: { tripId: trip.id, day } })).sort(
      (a, b) => a.order - b.order,
    );
    for (let i = 0; i < items.length; i += 1) {
      const entry = items[i]!;
      if (i === 0) {
        (entry as { travelTimeMin?: number | null }).travelTimeMin = null;
      } else {
        entry.travelTimeMin = await this.travelMinutes(
          trip,
          items[i - 1]!.coordinates,
          entry.coordinates,
          this.departureFrom(items[i - 1]!),
        );
      }
    }
    if (items.length > 0) await this.itemsRepo.save(items);
  }

  /** trip.startDate 기준 day 번째 날의 달력 날짜(YYYY-MM-DD). */
  private dayBaseDate(trip: TripEntity, day: number): string {
    const base = new Date(`${trip.startDate}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + (day - 1));
    return base.toISOString().slice(0, 10);
  }

  /** Date → Asia/Seoul 기준 YYYY-MM-DD 문자열. */
  private kstDateString(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  /** YYYY-MM-DD + HH:mm(KST) → UTC Date. */
  private combineScheduledAt(dateStr: string, hhmm: string): Date {
    if (!/^\d{2}:\d{2}$/.test(hhmm)) {
      throw new BadRequestException('시간 형식은 HH:mm 이어야 합니다.');
    }
    return new Date(`${dateStr}T${hhmm}:00+09:00`);
  }

  /** 좌표 소유 항목의 출발 시각(= 해당 항목 종료 시각)을 구한다. 대중교통 시간표 조회용. */
  private departureFrom(item: { scheduledAt: Date; durationMin: number }): Date {
    return new Date(new Date(item.scheduledAt).getTime() + item.durationMin * 60000);
  }

  /** 교통수단에 맞춰 두 좌표 사이 이동 시간(분)을 계산 (OTP 미가동 시 로컬 추정). */
  private async travelMinutes(
    trip: TripEntity,
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    departAt?: Date,
  ): Promise<number> {
    const eta =
      trip.transportMode === 'car'
        ? await this.routeHelper.getDrivingEta(from, to, departAt)
        : await this.routeHelper.getTransitEta(from, to, departAt);
    return Math.max(1, Math.round(eta.durationSec / 60));
  }

  /** 두 연속 일정 사이 시간 간격이 (체류 + 이동)보다 짧으면 경고를 추가한다. */
  private pushGapWarning(
    warnings: string[],
    from: ItineraryItemEntity,
    to: ItineraryItemEntity,
    travelMin: number,
  ): void {
    const gapMin = Math.round(
      (new Date(to.scheduledAt).getTime() - new Date(from.scheduledAt).getTime()) / 60000,
    );
    const needed = from.durationMin + travelMin;
    if (gapMin < needed) {
      warnings.push(
        `"${from.name}" → "${to.name}" 이동시간이 빠듯해요 (필요 약 ${needed}분, 일정 간격 ${gapMin}분)`,
      );
    }
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

  /**
   * 생성 폼의 구조화 옵션(일정 강도·예산·이동 수단·꼭 포함할 장소)을 자유 텍스트 notes 로 합쳐
   * AI 일정 생성 시 프롬프트에 반영되도록 한다. (별도 컬럼 없이 notes 로 전달)
   */
  private composeCreateTripNotes(dto: CreateTripRequestDto): string | undefined {
    const paceLabel = { relaxed: '여유롭게', balanced: '균형', packed: '알차게' };
    const budgetLabel = { thrifty: '알뜰', normal: '보통', premium: '프리미엄' };
    const transportLabel = { transit: '대중교통', car: '자가용' };

    const hints: string[] = [];
    if (dto.pace) hints.push(`일정 강도: ${paceLabel[dto.pace]}`);
    if (dto.budget) hints.push(`예산: ${budgetLabel[dto.budget]}`);
    if (dto.transportMode) hints.push(`이동 수단: ${transportLabel[dto.transportMode]}`);
    if (dto.mustIncludePlaces?.length) {
      const names = dto.mustIncludePlaces.map((p) => p.name.trim()).filter(Boolean);
      if (names.length) hints.push(`꼭 포함할 장소: ${names.join(', ')}`);
    }

    const parts = [dto.notes?.trim(), hints.length ? hints.join(' · ') : ''].filter(Boolean);
    return parts.length ? parts.join('\n') : undefined;
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

  private async toPlannerTrip(
    trip: TripEntity,
    members: TripMemberDto[],
    items: ItineraryItemEntity[],
    tasteTags?: PlannerTripDto['meta']['tasteTags'],
    isOwner = false,
  ): Promise<PlannerTripDto> {
    const days = this.buildDays(trip.startDate, trip.endDate);
    const markers = this.withNormalizedMarkerPositions(
      items.map((item, index) => this.toMarker(item, index, index === 0 ? 'current' : 'primary')),
    );
    const center = this.mapCenter(items, trip.destination);
    const totalTravelMin = items.reduce((sum, item) => sum + (item.travelTimeMin ?? 0), 0);

    return {
      id: trip.id,
      title: trip.title,
      isOwner,
      members: members.map((member) => this.toPlannerMember(member)),
      searchPlaceholder: `${trip.destination} 장소 검색...`,
      mapCenter: center,
      mapMarkers: markers,
      days,
      items: items.map((item) => this.toPlannerItem(item)),
      progress: this.tripProgress(trip, days.length),
      meta: {
        startDate: trip.startDate,
        endDate: trip.endDate,
        durationLabel: this.durationLabel(trip.startDate, trip.endDate),
        transportLabel: this.transportLabel(trip.transportMode),
        transportMode: trip.transportMode,
        wakeTime: trip.wakeTime ?? '08:00',
        sleepTime: trip.sleepTime ?? '23:00',
        tasteTags: tasteTags ?? { food: [], mood: [], environment: [] },
        stats: {
          totalItems: items.length,
          waitingCount: items.filter((item) => item.type === 'restaurant').length,
          estimatedTravelKm: Math.round((totalTravelMin / 12) * 10) / 10,
        },
        weather: await this.buildWeather(center, days),
      },
    };
  }

  /**
   * 기상청 예보를 일자별 PlannerWeatherDto 로 변환한다.
   * - center 좌표로 단기(~3일)+중기(+3~+10일) 예보를 조회해 각 일자의 fcstDate 로 매핑한다.
   * - 예보 범위(~10일) 밖이거나 KMA_API_KEY 미설정 시 "확인 전" 폴백을 유지한다.
   */
  private async buildWeather(
    center: PlannerTripDto['mapCenter'],
    days: Array<{ day: number; dateLabel: string; iso: string }>,
  ): Promise<PlannerTripDto['meta']['weather']> {
    const fallback = (day: { day: number; dateLabel: string }) => ({
      day: day.day,
      label: `${day.dateLabel} 날씨 확인 전`,
      emoji: '☁️',
      tempLabel: '-',
      forecasted: false,
    });

    let forecasts: Map<string, ParsedForecast>;
    try {
      forecasts = await this.weatherHelper.getExtendedForecast(center.lat, center.lng);
    } catch {
      return days.map(fallback);
    }
    if (forecasts.size === 0) {
      return days.map(fallback);
    }

    return days.map((day) => {
      const kmaDate = day.iso.replace(/-/g, '');
      const slots = [...forecasts.values()].filter((f) => f.date === kmaDate);
      if (slots.length === 0) {
        return fallback(day);
      }

      const temps = slots
        .map((s) => s.temperature)
        .filter((t): t is number => typeof t === 'number');
      const tempLabel =
        temps.length > 0
          ? `${Math.round(Math.min(...temps))}° / ${Math.round(Math.max(...temps))}°`
          : '-';

      // 낮(12~15시) 대표 슬롯 우선, 없으면 첫 슬롯으로 하늘/강수 상태 판정
      const noon =
        slots.find((s) => s.time === '1500' || s.time === '1200') ?? slots[0]!;
      const { emoji, condition } = this.describeWeather(noon);

      return {
        day: day.day,
        label: `${day.dateLabel} ${condition}`,
        emoji,
        tempLabel,
        forecasted: true,
      };
    });
  }

  /**
   * 강수형태(PTY) 우선, 없으면 하늘상태(SKY)로 emoji·한글 상태를 만든다.
   * PTY: 0 없음 / 1 비 / 2 비·눈 / 3 눈 / 4 소나기
   * SKY: 1 맑음 / 3 구름많음 / 4 흐림
   */
  private describeWeather(f: ParsedForecast): { emoji: string; condition: string } {
    switch (f.precipitationType) {
      case 1:
        return { emoji: '🌧️', condition: '비' };
      case 2:
        return { emoji: '🌨️', condition: '비/눈' };
      case 3:
        return { emoji: '❄️', condition: '눈' };
      case 4:
        return { emoji: '🌦️', condition: '소나기' };
    }
    switch (f.skyCondition) {
      case 1:
        return { emoji: '☀️', condition: '맑음' };
      case 3:
        return { emoji: '⛅', condition: '구름많음' };
      case 4:
        return { emoji: '☁️', condition: '흐림' };
      default:
        return { emoji: '☁️', condition: '흐림' };
    }
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
      status: member.status,
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
      durationMin: item.durationMin,
      ...(item.memo ? { memo: item.memo } : {}),
      ...(item.kakaoPlaceId ? { kakaoPlaceId: item.kakaoPlaceId } : {}),
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

  /**
   * 기본 추천: CRAG/임베딩 파이프라인(PlaceRetrievalService)으로 취향을 반영한 대안을 만든다.
   * - 저장된 취향 벡터(preference_embeddings) 로 pgvector 검색을 개인화
   * - CRAG 평가로 confidence 채점 후 상위 다양성 선별
   * 같은 카테고리 후보를 우선하되, 3개 미만이면 카테고리 무관 후보로 채운다.
   * 결과가 없으면(임베딩/키 미설정 등) 빈 배열 → 호출부가 mock 으로 폴백.
   */
  private async buildRecommendedAlternatives(
    trip: TripEntity,
    item: ItineraryItemEntity,
    note?: string,
  ): Promise<PlannerAlternativeDto[]> {
    const preference = await this.preferencesService.findByUser(trip.userId);
    const tasteTags = preference?.tasteTags;
    const preferenceVector = await this.preferencesService.getPreferenceVector(trip.userId);
    const waiting = item.type === 'restaurant';
    // 여행 고정 노트 + 이번 요청 조건(note)을 합쳐 검색을 개인화
    const combinedNotes =
      [trip.notes, note].map((v) => v?.trim()).filter(Boolean).join(' · ') || null;

    let retrieval;
    try {
      retrieval = await this.placeRetrieval.retrieve({
        userId: trip.userId,
        destination: trip.destination,
        notes: combinedNotes,
        limit: 14,
        currentLocation: item.coordinates,
        ...(tasteTags !== undefined ? { tasteTags } : {}),
        ...(preferenceVector ? { preferenceVector } : {}),
        ...(waiting ? { trigger: 'waiting' as const } : {}),
      });
    } catch {
      return [];
    }

    const itemType = this.toPlannerItemType(item.type);
    // P2-7: 이미 이 여행 일정에 담긴 장소는 대안에서 제외 (현재 항목 포함)
    const tripItems = await this.itemsRepo.find({ where: { tripId: trip.id } });
    const usedNames = new Set(tripItems.map((entry) => entry.name.trim()));
    const seen = new Set<string>();
    const deduped = retrieval.places.filter((place) => {
      if (usedNames.has(place.name.trim())) return false;
      const key = place.kakaoPlaceId ?? `${place.name}:${place.address}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 같은 카테고리 우선, 3개 미만이면 전체 후보 사용 (CRAG 순위 보존)
    const sameCategory = deduped.filter((place) => this.toPlannerItemType(place.category) === itemType);
    const pool = sameCategory.length >= 3 ? sameCategory : deduped;

    return pool.slice(0, 5).map((place, index) => this.toRetrievedAlternative(item, place, index));
  }

  /** CRAG CandidatePlace → 화면용 대안 DTO (취향 근거 reason 표시) */
  private toRetrievedAlternative(
    item: ItineraryItemEntity,
    place: CandidatePlace,
    index: number,
  ): PlannerAlternativeDto {
    const category = this.toPlannerItemType(place.category);
    const secondary = place.reason?.trim()
      ? place.reason.trim().slice(0, 28)
      : this.categoryLabel(category);
    const badge =
      index === 0
        ? { badge: '취향 1순위', badgeTone: 'recommend' as const }
        : index === 1
          ? { badge: '취향 추천', badgeTone: 'local' as const }
          : { badge: '후보', badgeTone: 'urgent' as const };

    return {
      id: `${item.id}:crag-${place.kakaoPlaceId ?? place.id ?? index}`,
      categoryEmoji: this.categoryEmoji(category),
      categoryTone: index === 0 ? 'primary' : index === 1 ? 'success' : 'neutral',
      name: place.name,
      walkLabel: this.distanceLabel(item.coordinates, place.coordinates),
      waitLabel: secondary,
      // 카카오/pgvector 후보엔 신뢰할 평점이 없어 별점을 넣지 않는다
      ...(place.rating !== undefined ? { rating: place.rating } : {}),
      mapHref: place.kakaoPlaceId
        ? `https://place.map.kakao.com/${place.kakaoPlaceId}`
        : `https://map.kakao.com/?q=${encodeURIComponent(place.name)}`,
      ...badge,
      lat: place.coordinates.lat,
      lng: place.coordinates.lng,
      ...(place.address ? { address: place.address } : {}),
      ...(place.kakaoPlaceId ? { kakaoPlaceId: place.kakaoPlaceId } : {}),
      category,
      origin: 'recommend',
      realPlace: true,
    };
  }

  /** 장소 이름 검색으로 해석한 카카오 장소 → 화면용 대안 DTO (사용자 직접 지정) */
  private toRealAlternative(
    item: ItineraryItemEntity,
    place: RawPlaceCandidate,
  ): PlannerAlternativeDto {
    const category = this.toPlannerItemType(place.category);
    const secondary = place.categoryDetail
      ? place.categoryDetail.split('>').pop()?.trim() || this.categoryLabel(category)
      : this.categoryLabel(category);

    return {
      id: `${item.id}:kakao-${place.kakaoPlaceId ?? place.name}`,
      categoryEmoji: this.categoryEmoji(category),
      categoryTone: 'primary',
      name: place.name,
      walkLabel: this.distanceLabel(item.coordinates, place.coordinates),
      waitLabel: secondary,
      mapHref: place.kakaoPlaceId
        ? `https://place.map.kakao.com/${place.kakaoPlaceId}`
        : `https://map.kakao.com/?q=${encodeURIComponent(place.name)}`,
      badge: '내가 지정',
      badgeTone: 'recommend',
      lat: place.coordinates.lat,
      lng: place.coordinates.lng,
      ...(place.address ? { address: place.address } : {}),
      ...(place.kakaoPlaceId ? { kakaoPlaceId: place.kakaoPlaceId } : {}),
      category,
      origin: 'link',
      realPlace: true,
    };
  }

  private buildAlternatives(item: ItineraryItemEntity): PlannerAlternativeDto[] {
    const baseNames =
      item.type === 'restaurant'
        ? ['로컬 한식당', '웨이팅 적은 맛집', '근처 시그니처 식당']
        : item.type === 'cafe'
          ? ['조용한 로컬 카페', '뷰 좋은 카페', '디저트 카페']
          : ['근처 산책 스팟', '실내 문화 공간', '사진 찍기 좋은 장소'];
    const category = this.toPlannerItemType(item.type);

    return baseNames.map((name, index) => {
      const latOffset = (index % 2 === 0 ? -1 : 1) * (0.003 + index * 0.001);
      const lngOffset = (index % 2 === 0 ? 1 : -1) * (0.0035 + index * 0.001);
      return {
        id: `${item.id}:alt-${index + 1}`,
        categoryEmoji: this.categoryEmoji(category),
        categoryTone: index === 0 ? 'primary' : index === 1 ? 'success' : 'neutral',
        name: `${item.name} 대안 ${name}`,
        walkLabel: `도보 ${8 + index * 4}분`,
        waitLabel: item.type === 'restaurant' ? `대기 ${Math.max(0, 10 - index * 5)}분` : '바로 입장',
        mapHref: `https://map.kakao.com/?q=${encodeURIComponent(`${item.name} ${name}`)}`,
        badge: index === 0 ? '추천' : index === 1 ? '빠름' : '근처',
        badgeTone: (index === 0 ? 'recommend' : index === 1 ? 'local' : 'urgent') as PlannerAlternativeDto['badgeTone'],
        lat: item.coordinates.lat + latOffset,
        lng: item.coordinates.lng + lngOffset,
        category,
        origin: 'recommend' as const,
        realPlace: false,
      };
    });
  }

  private toPlannerItemType(category: string): PlannerItemType {
    if (category === 'restaurant' || category === 'cafe' || category === 'transport') {
      return category;
    }
    return 'attraction';
  }

  private categoryEmoji(category: PlannerItemType): string {
    return category === 'restaurant' ? '🍚' : category === 'cafe' ? '☕' : category === 'transport' ? '🚉' : '📍';
  }

  private categoryLabel(category: PlannerItemType): string {
    return category === 'restaurant' ? '음식점' : category === 'cafe' ? '카페' : category === 'transport' ? '이동' : '관광';
  }

  /** 항목 기준 거리 표시: 가까우면 도보 분, 멀면 km. */
  private distanceLabel(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): string {
    const meters = this.distanceMeters(from, to);
    if (meters <= 1500) {
      return `도보 ${Math.max(1, Math.round(meters / 67))}분`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
  }

  private distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6371000;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * 사용자 입력을 카카오 Local 검색 키워드로 정규화한다.
   * - 일반 장소 이름: 입력 텍스트 그대로 사용
   * - http(s) 링크(붙여넣기 허용): 단축링크면 리다이렉트를 따라간 뒤 q/query/keyword 파라미터나 검색 경로 세그먼트에서 추출
   */
  private async extractSearchKeyword(input: string): Promise<string | null> {
    const raw = input.trim();
    if (!raw) return null;
    if (!/^https?:\/\//i.test(raw)) {
      return raw.length <= 60 ? raw : raw.slice(0, 60);
    }

    let finalUrl = raw;
    try {
      const res = await axios.get(raw, {
        maxRedirects: 5,
        timeout: 5000,
        // 본문은 필요 없고 최종 URL 만 확인 — 일부 서버는 HEAD 를 막아 GET 사용
        validateStatus: () => true,
      });
      const responseUrl = (res.request?.res?.responseUrl ?? res.request?.responseURL) as
        | string
        | undefined;
      if (responseUrl) finalUrl = responseUrl;
    } catch {
      // 리다이렉트 해석 실패 시 원본 URL 로 파싱 시도
    }

    return this.keywordFromUrl(finalUrl);
  }

  private keywordFromUrl(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }

    for (const key of ['q', 'query', 'keyword', 'name']) {
      const value = parsed.searchParams.get(key);
      if (value && value.trim()) return value.trim();
    }

    // 검색형 경로 (예: map.naver.com/p/search/<장소명>) 의 마지막 한글 포함 세그먼트
    const segments = parsed.pathname
      .split('/')
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const segment = segments[i];
      if (segment && /[가-힣]/.test(segment) && !/^\d+$/.test(segment)) return segment;
    }
    return null;
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
    alternative: PlannerAlternativeDto,
    index: number,
  ): PlannerMapMarkerDto {
    return {
      id: `marker-${alternative.id}`,
      label: alternative.name,
      order: index + 1,
      lat: alternative.lat,
      lng: alternative.lng,
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
        iso,
      };
    });
  }

  /**
   * KST(+09:00) 기준으로 오늘이 여행의 몇 일차인지와 진행 상태를 파생한다.
   * 클라가 startDate 로 직접 계산하던 로직을 서버로 옮긴 것.
   */
  private tripProgress(trip: TripEntity, totalDays: number): PlannerTripProgressDto {
    const status = this.summaryStatus(trip);
    const start = new Date(`${trip.startDate}T00:00:00+09:00`);
    const today = new Date(`${this.isoDate(new Date())}T00:00:00+09:00`);
    const dayDiff = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
    const currentDay = Math.min(Math.max(dayDiff, 1), Math.max(totalDays, 1));
    return {
      status,
      currentDay,
      totalDays,
      serverTime: new Date().toISOString(),
    };
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
      draft: '준비 중',
      upcoming: '출발 전',
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
