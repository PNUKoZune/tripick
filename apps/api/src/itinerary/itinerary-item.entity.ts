import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { TripEntity } from '../trips/trip.entity';
import type { ItineraryItemType, Coordinates } from '@tripick/types';

@Entity('itinerary_items')
export class ItineraryItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tripId: string;

  @ManyToOne(() => TripEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tripId' })
  trip: TripEntity;

  @Column()
  day: number;

  @Column()
  order: number;

  @Column()
  type: ItineraryItemType;

  @Column()
  name: string;

  @Column()
  address: string;

  @Column({ type: 'jsonb' })
  coordinates: Coordinates;

  @Column({ type: 'timestamptz' })
  scheduledAt: Date;

  @Column()
  durationMin: number;

  @Column({ nullable: true })
  travelTimeMin?: number;

  @Column({ nullable: true })
  openingHours?: string;

  @Column({ nullable: true })
  phoneNumber?: string;

  @Column({ nullable: true })
  kakaoPlaceId?: string;

  @Column({ nullable: true })
  imageUrl?: string;

  @Column({ nullable: true })
  memo?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
