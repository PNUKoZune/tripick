import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TripEntity } from './trip.entity';
import { PlannerService } from '../planner/planner.service';
import type { CreateTripDto, UpdateTripDto } from '@tripick/types';

@Injectable()
export class TripsService {
  constructor(
    @InjectRepository(TripEntity)
    private readonly repo: Repository<TripEntity>,
    private readonly plannerService: PlannerService,
  ) {}

  findByUser(userId: string): Promise<TripEntity[]> {
    return this.repo.find({ where: { userId }, order: { createdAt: 'DESC' } });
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
    await this.plannerService.generateItinerary(saved.id);
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
