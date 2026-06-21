import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TripEntity } from '../trips/trip.entity';
import { UserEntity } from '../users/user.entity';
import type { TripMemberPreferenceDto, TripMemberRole, TripMemberStatus } from '@tripick/types';

@Entity('trip_members')
export class TripMemberEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tripId: string;

  @ManyToOne(() => TripEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tripId' })
  trip: TripEntity;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity | null;

  @Column({ type: 'uuid', nullable: true })
  friendId: string | null;

  @Column()
  nickname: string;

  @Column({ type: 'varchar', nullable: true })
  contact: string | null;

  @Column({ type: 'varchar', nullable: true })
  kakaoId: string | null;

  @Column({ type: 'varchar', nullable: true })
  relation: string | null;

  @Column({ default: 'companion' })
  role: TripMemberRole;

  @Column({ default: 'pending' })
  status: TripMemberStatus;

  @Column({ default: '#3182F6' })
  color: string;

  @Column({ type: 'jsonb', default: '{}' })
  preferenceTags: TripMemberPreferenceDto;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
