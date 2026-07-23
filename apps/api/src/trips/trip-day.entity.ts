import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TripEntity } from './trip.entity';

/**
 * 일자별 지역 매핑. 하루에 여러 지역을 담을 수 있어 (tripId, day)당 여러 행이 생긴다.
 * trip 삭제 시 CASCADE 로 함께 지워진다. day 는 1-based, sortOrder 는 하루 안에서의 지역 순서.
 */
@Entity('trip_days')
@Index(['tripId', 'day'])
export class TripDayEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tripId: string;

  @ManyToOne(() => TripEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tripId' })
  trip: TripEntity;

  @Column({ type: 'int' })
  day: number;

  @Column()
  region: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;
}
