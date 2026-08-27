import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';
import type { RouteMode, TripStatus } from '@tripick/types';

@Entity('trips')
export class TripEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column()
  title: string;

  @Column()
  destination: string;

  @Column({ type: 'date' })
  startDate: string;

  @Column({ type: 'date' })
  endDate: string;

  @Column({ default: 'draft' })
  status: TripStatus;

  @Column({ nullable: true })
  sleepTime?: string;

  @Column({ nullable: true })
  wakeTime?: string;

  @Column({ default: 'transit' })
  transportMode: RouteMode;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** 공유 링크 토큰. 설정 시 공개 공유 페이지에서 조회 가능 */
  @Column({ type: 'varchar', nullable: true, unique: true })
  shareToken: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
