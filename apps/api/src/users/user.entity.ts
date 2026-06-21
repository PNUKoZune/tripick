import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { NotificationPreferencesDto } from '@tripick/types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@tripick/types';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  kakaoId: string;

  @Column({ default: false })
  isDemo: boolean;

  @Column()
  nickname: string;

  @Column({ nullable: true })
  profileImageUrl?: string;

  @Column({ nullable: true, unique: true })
  email?: string;

  /** Firebase FCM 디바이스 토큰 */
  @Column({ nullable: true })
  fcmToken?: string;

  /** 인박스 카테고리별 수신 여부 (jsonb). 미설정 카테고리는 DEFAULT_NOTIFICATION_PREFERENCES 적용 */
  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES)}'::jsonb` })
  notificationPreferences: NotificationPreferencesDto;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
