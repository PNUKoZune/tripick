import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { NotificationPreferencesDto } from '@tripick/types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@tripick/types';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 카카오 가입자에만 채워짐. 이메일 가입자는 null. */
  @Index({ unique: true, where: '"kakaoId" IS NOT NULL' })
  @Column({ nullable: true })
  kakaoId?: string;

  /** 이메일 가입자에만 채워짐. 카카오 가입자도 카카오에서 이메일 동의받으면 채워짐. */
  @Index({ unique: true, where: '"email" IS NOT NULL' })
  @Column({ nullable: true })
  email?: string;

  /** bcrypt hash. 이메일 가입자만 가짐. 카카오 단독 가입자는 null. 이메일 인증 완료 후에만 채워짐. */
  @Column({ nullable: true })
  passwordHash?: string;

  /**
   * 인증 대기 중인 bcrypt hash. 가입/계정 연동 시 여기 먼저 저장하고,
   * 이메일 인증 토큰을 소비할 때 비로소 passwordHash 로 승격한다.
   * (인증 전에는 로그인 불가 → 이메일 소유 증명 없이 비밀번호 활성화되는 계정 탈취 차단)
   */
  @Column({ nullable: true })
  pendingPasswordHash?: string | null;

  /** 이메일 인증 완료 시각. null = 미인증 상태. 카카오 가입자는 자동으로 채워짐. */
  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt?: Date;

  @Column({ default: false })
  isDemo: boolean;

  @Column()
  nickname: string;

  @Column({ nullable: true })
  profileImageUrl?: string;

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
