import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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

  /**
   * 지정한 일차의 항목만 교체한다(일자별 재계획). 나머지 일차는 손대지 않는다.
   * `items` 는 그 일차들의 새 항목이어야 하며, 대상 일차 삭제 → 삽입을 한 트랜잭션으로 묶어
   * 중간에 실패했을 때 일정이 비어버리지 않게 한다.
   */
  async replaceDayItems(
    tripId: string,
    days: number[],
    items: CreateItineraryItemDto[],
  ): Promise<ItineraryItemEntity[]> {
    if (days.length === 0) return [];
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(ItineraryItemEntity);
      await repo.delete({ tripId, day: In(days) });
      const entities = items.map((item) =>
        repo.create({
          ...item,
          scheduledAt: new Date(item.scheduledAt),
        }),
      );
      return entities.length > 0 ? repo.save(entities) : [];
    });
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
