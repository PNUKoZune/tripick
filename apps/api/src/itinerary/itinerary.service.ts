import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItineraryItemEntity } from './itinerary-item.entity';
import { TripEntity } from '../trips/trip.entity';
import type { CreateItineraryItemDto } from '@tripick/types';

@Injectable()
export class ItineraryService {
  constructor(
    @InjectRepository(ItineraryItemEntity)
    private readonly repo: Repository<ItineraryItemEntity>,
    @InjectRepository(TripEntity)
    private readonly tripsRepo: Repository<TripEntity>,
  ) {}

  async findByTrip(tripId: string, userId: string): Promise<ItineraryItemEntity[]> {
    await this.assertTripOwner(tripId, userId);
    return this.repo.find({
      where: { tripId },
      order: { day: 'ASC', order: 'ASC' },
    });
  }

  async replaceTripItems(tripId: string, items: CreateItineraryItemDto[]): Promise<ItineraryItemEntity[]> {
    await this.repo.delete({ tripId });
    const entities = items.map((item) =>
      this.repo.create({
        ...item,
        scheduledAt: new Date(item.scheduledAt),
      }),
    );
    return this.repo.save(entities);
  }

  async deleteByTrip(tripId: string): Promise<void> {
    await this.repo.delete({ tripId });
  }

  private async assertTripOwner(tripId: string, userId: string): Promise<void> {
    const trip = await this.tripsRepo.findOneBy({ id: tripId });
    if (!trip) {
      throw new NotFoundException(`Trip ${tripId} not found`);
    }
    if (trip.userId !== userId) {
      throw new ForbiddenException();
    }
  }
}
