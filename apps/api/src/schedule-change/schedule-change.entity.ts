import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TripEntity } from '../trips/trip.entity';
import { UserEntity } from '../users/user.entity';
import type {
  ScheduleChangeKind,
  ScheduleChangePayload,
  ScheduleChangeStatus,
} from '@tripick/types';

/**
 * 여행 참여자(비-owner)가 낸 일정 변경 제안. owner 승인 전까지 pending 으로 대기하고,
 * 승인 시 payload 를 owner 권한으로 재실행(replay)한다. trip_invite 와 같은 승인 흐름.
 */
@Entity('schedule_change_proposals')
@Index(['tripId', 'status'])
@Index(['requesterId', 'status'])
export class ScheduleChangeProposalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tripId: string;

  @ManyToOne(() => TripEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tripId' })
  trip: TripEntity;

  /** 제안을 낸 참여자 */
  @Column()
  requesterId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requesterId' })
  requester: UserEntity;

  @Column({ type: 'varchar' })
  kind: ScheduleChangeKind;

  @Column({ type: 'jsonb' })
  payload: ScheduleChangePayload;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: ScheduleChangeStatus;

  /** 미리보기·딥링크용(있으면) */
  @Column({ type: 'int', nullable: true })
  day: number | null;

  @Column({ type: 'varchar', nullable: true })
  targetItemId: string | null;

  /** owner 승인/거절 처리 시각 */
  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
