import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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
    const trip = this.repo.create({ userId, ...dto });
    const saved = await this.repo.save(trip);
    // 일정 생성은 비동기로 처리 (Planner)
    this.plannerService.generateItinerary(saved.id).catch((err) =>
      console.error(`Failed to generate itinerary for trip ${saved.id}:`, err),
    );
    return saved;
  }

  async update(id: string, userId: string, dto: UpdateTripDto): Promise<TripEntity> {
    const trip = await this.findOne(id, userId);
    Object.assign(trip, dto);
    return this.repo.save(trip);
  }

  async remove(id: string, userId: string): Promise<void> {
    const trip = await this.findOne(id, userId);
    await this.repo.remove(trip);
  }
}
