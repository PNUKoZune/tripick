import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItineraryItemEntity } from './itinerary-item.entity';
import type { CreateItineraryItemDto } from '@tripick/types';

@Injectable()
export class ItineraryService {
  constructor(
    @InjectRepository(ItineraryItemEntity)
    private readonly repo: Repository<ItineraryItemEntity>,
  ) {}

  findByTrip(tripId: string): Promise<ItineraryItemEntity[]> {
    return this.repo.find({
      where: { tripId },
      order: { day: 'ASC', order: 'ASC' },
    });
  }

  async bulkUpsert(items: CreateItineraryItemDto[]): Promise<ItineraryItemEntity[]> {
    const entities = items.map((item) => this.repo.create(item));
    return this.repo.save(entities);
  }

  async deleteByTrip(tripId: string): Promise<void> {
    await this.repo.delete({ tripId });
  }
}
