import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { TripEntity } from './trip.entity';
import { TripDayEntity } from './trip-day.entity';
import { TripMemberEntity } from '../trip-members/trip-member.entity';
import { TripGenerationService } from '../trip-generation/trip-generation.service';
import type { CreateTripDto, TripGenerationJobDto, UpdateTripDto } from '@tripick/types';

export interface CreateTripOptions {
  /** 생성 잡이 시작되기 전에 동행자처럼 검색 입력에 필요한 연관 데이터를 저장한다. */
  beforeEnqueue?: (trip: TripEntity, manager: EntityManager) => Promise<void>;
  requestKey?: string;
  requestInput?: unknown;
}

@Injectable()
export class TripsService {
  constructor(
    @InjectRepository(TripEntity)
    private readonly repo: Repository<TripEntity>,
    @InjectRepository(TripDayEntity)
    private readonly tripDaysRepo: Repository<TripDayEntity>,
    @InjectRepository(TripMemberEntity)
    private readonly membersRepo: Repository<TripMemberEntity>,
    private readonly tripGeneration: TripGenerationService,
  ) {}

  findByUser(userId: string): Promise<TripEntity[]> {
    return this.repo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /** 본인이 owner 인 trip + accepted 멤버로 참여 중인 trip 을 합쳐서 반환 */
  async findVisible(userId: string): Promise<TripEntity[]> {
    const owned = await this.findByUser(userId);
    const memberRows = await this.membersRepo.find({
      where: { userId, status: 'accepted' },
    });
    const joinedIds = memberRows
      .map((row) => row.tripId)
      .filter((tripId) => !owned.some((trip) => trip.id === tripId));
    if (joinedIds.length === 0) return owned;
    const joined = await this.repo.find({ where: joinedIds.map((id) => ({ id })) });
    return [...owned, ...joined].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  /** owner 또는 accepted 멤버 가 trip 을 조회할 수 있는지 검증 후 반환 */
  async findOneForViewer(id: string, userId: string): Promise<TripEntity> {
    const trip = await this.repo.findOneBy({ id });
    if (!trip) throw new NotFoundException(`Trip ${id} not found`);
    if (trip.userId === userId) return trip;
    const membership = await this.membersRepo.findOneBy({
      tripId: id,
      userId,
      status: 'accepted',
    });
    if (!membership) throw new ForbiddenException();
    return trip;
  }

  async findOne(id: string, userId: string): Promise<TripEntity> {
    const trip = await this.repo.findOneBy({ id });
    if (!trip) throw new NotFoundException(`Trip ${id} not found`);
    if (trip.userId !== userId) throw new ForbiddenException();
    return trip;
  }

  async create(
    userId: string,
    dto: CreateTripDto,
    options: CreateTripOptions = {},
  ): Promise<TripEntity> {
    this.assertTrip(dto.startDate, dto.endDate, dto.wakeTime, dto.sleepTime);
    const accepted = await this.tripGeneration.ledger.admit(
      userId, options.requestKey, options.requestInput ?? dto, async (manager) => {
        const trips = manager.getRepository(TripEntity);
        const tripDays = manager.getRepository(TripDayEntity);
        const trip = trips.create({
          userId,
          ...dto,
          status: 'generating',
          transportMode: dto.transportMode ?? 'transit',
          wakeTime: dto.wakeTime ?? '08:30',
          sleepTime: dto.sleepTime ?? '22:00',
        });
        const saved = await trips.save(trip);
        // 검색 입력과 접수 원장이 함께 커밋되어 worker가 불완전한 입력을 읽지 않는다.
        if (dto.dayRegions?.length) {
          await tripDays.save(dto.dayRegions.flatMap((regions, dayIndex) =>
            regions.map((region, sortOrder) => tripDays.create({
              tripId: saved.id, day: dayIndex + 1, region, sortOrder,
            })),
          ));
        }
        await options.beforeEnqueue?.(saved, manager);
        return saved;
      },
    );
    // Redis is a delivery mechanism: its failure must never delete a committed trip.
    void this.tripGeneration.publishPending();
    return accepted.trip;
  }

  async getGenerationStatus(
    id: string,
    userId: string,
  ): Promise<TripGenerationJobDto> {
    const trip = await this.findOneForViewer(id, userId);
    const status = await this.tripGeneration.getStatus(trip.id, trip.status);
    return { ...status, canCancel: trip.userId === userId && Boolean(status.canCancel) };
  }

  async retryGeneration(id: string, userId: string, requestKey?: string): Promise<TripGenerationJobDto> {
    await this.findOne(id, userId);
    return this.tripGeneration.retry(id, userId, requestKey);
  }

  async cancelGeneration(id: string, userId: string): Promise<TripGenerationJobDto> {
    const trip = await this.findOne(id, userId);
    return this.tripGeneration.cancel(id, userId, trip.status);
  }

  async update(id: string, userId: string, dto: UpdateTripDto): Promise<TripEntity> {
    await this.findOne(id, userId);
    return this.tripGeneration.ledger.mutateTrip(id, async (manager) => {
      const trips = manager.getRepository(TripEntity);
      const trip = await trips.findOneByOrFail({ id, userId });
      this.assertTrip(trip.startDate, trip.endDate, dto.wakeTime ?? trip.wakeTime, dto.sleepTime ?? trip.sleepTime);
      Object.assign(trip, dto);
      return trips.save(trip);
    });
  }

  async mutateItinerary<T>(id: string, userId: string, write: (trip: TripEntity, manager: EntityManager) => Promise<T>): Promise<T> {
    await this.findOne(id, userId);
    return this.tripGeneration.ledger.mutateTrip(id, async (manager) => {
      const trip = await manager.getRepository(TripEntity).findOneByOrFail({ id, userId });
      return write(trip, manager);
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.findOne(id, userId);
    await this.tripGeneration.ledger.mutateTrip(id, async (manager) => {
      await manager.getRepository(TripEntity).delete({ id, userId });
    });
  }

  private assertTrip(startDate: string, endDate: string, wakeTime?: string, sleepTime?: string): void {
    if (endDate < startDate) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
    // 취침이 기상보다 이른 건 자정을 넘는 활동 구간(예: 08:00 기상 / 01:00 취침)이라 정상이다.
    // 같은 시각만 거부한다 — 활동 0분과 24시간 중 무엇을 뜻하는지 정할 수 없다.
    if (wakeTime && sleepTime && wakeTime === sleepTime) {
      throw new BadRequestException('wakeTime and sleepTime must differ');
    }
  }
}
