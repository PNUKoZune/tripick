import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TripEntity } from './trip.entity';
import { PlannerService } from '../planner/planner.service';
import { TripMemberEntity } from '../trip-members/trip-member.entity';
import type { CreateTripDto, UpdateTripDto } from '@tripick/types';

@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);

  constructor(
    @InjectRepository(TripEntity)
    private readonly repo: Repository<TripEntity>,
    @InjectRepository(TripMemberEntity)
    private readonly membersRepo: Repository<TripMemberEntity>,
    private readonly plannerService: PlannerService,
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

  async create(userId: string, dto: CreateTripDto): Promise<TripEntity> {
    this.assertTrip(dto.startDate, dto.endDate, dto.wakeTime, dto.sleepTime);
    const trip = this.repo.create({
      userId,
      ...dto,
      status: 'confirmed',
      transportMode: dto.transportMode ?? 'transit',
      wakeTime: dto.wakeTime ?? '08:30',
      sleepTime: dto.sleepTime ?? '22:00',
    });
    const saved = await this.repo.save(trip);
    try {
      await this.plannerService.generateItinerary(saved.id);
    } catch (error) {
      saved.status = 'draft';
      await this.repo.save(saved);
      this.logger.warn(
        `Trip ${saved.id} created without itinerary: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return this.findOne(saved.id, userId);
  }

  async update(id: string, userId: string, dto: UpdateTripDto): Promise<TripEntity> {
    const trip = await this.findOne(id, userId);
    this.assertTrip(trip.startDate, trip.endDate, dto.wakeTime ?? trip.wakeTime, dto.sleepTime ?? trip.sleepTime);
    Object.assign(trip, dto);
    return this.repo.save(trip);
  }

  async remove(id: string, userId: string): Promise<void> {
    const trip = await this.findOne(id, userId);
    await this.repo.remove(trip);
  }

  private assertTrip(startDate: string, endDate: string, wakeTime?: string, sleepTime?: string): void {
    if (endDate < startDate) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
    if (wakeTime && sleepTime && wakeTime >= sleepTime) {
      throw new BadRequestException('wakeTime must be earlier than sleepTime');
    }
  }
}
