import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';
import type { NotificationCategory } from '@tripick/types';

@Entity('notifications')
@Index(['userId', 'createdAt'])
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column({ type: 'varchar' })
  category: NotificationCategory;

  @Column()
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, string> | null;

  /** 사용자가 실제로 읽은 시각. 아카이브(보존 기간)의 유일한 기준이다. */
  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  /**
   * 수신 토글이 꺼져 있어 푸시 없이 인박스에만 남긴 알림의 생성 시각.
   *
   * `readAt` 을 대신 찍지 않는 이유: 아카이브가 `readAt` 기준 30일이라, 사용자가 읽지도
   * 않은 알림의 삭제 시계가 받은 순간부터 돌기 시작한다. 이력을 남기려던 목적이 무너진다.
   * 대신 이 컬럼으로 "안 읽었지만 배지는 올리지 않음"을 표현한다 — 안 읽은 알림은 나이와
   * 무관하게 보존된다는 기존 정책을 그대로 받는다.
   */
  @Column({ type: 'timestamptz', nullable: true })
  mutedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
