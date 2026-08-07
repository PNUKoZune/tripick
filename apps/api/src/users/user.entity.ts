import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { NotificationPreferencesDto } from '@tripick/types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from './notification-preferences.constants';

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

  /**
   * 가입 경로(카카오/이메일)와 무관한 고유 사용자 핸들. 친구 추가·멘션의 유일한 식별자.
   * 소문자 영숫자/언더스코어. 가입 시 자동 생성, 설정에서 변경 가능.
   */
  @Index({ unique: true, where: '"handle" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  handle?: string | null;

  /** bcrypt hash. 이메일 가입자만 가짐. 카카오 단독 가입자는 null. 이메일 인증 완료 후에만 채워짐. */
  @Column({ nullable: true })
  passwordHash?: string;

  /**
   * 인증 대기 중인 bcrypt hash. **신규 가입 시점에만** 채워지고, 이메일 인증 토큰을
   * 소비할 때 passwordHash 로 승격한다. (인증 전에는 로그인 불가)
   *
   * 이미 있는 계정에는 절대 다시 쓰지 않는다 — 남의 계정에 비밀번호를 심어 두고 주인이
   * 인증 링크를 누르게 만드는 탈취 경로가 열린다. 기존 계정의 비밀번호 설정·변경은
   * 재설정 플로우(setPassword)만 통한다.
   */
  @Column({ type: 'varchar', nullable: true })
  pendingPasswordHash?: string | null;

  /** 이메일 인증 완료 시각. null = 미인증 상태. 카카오 가입자는 자동으로 채워짐. */
  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt?: Date;


  @Column()
  nickname: string;

  @Column({ nullable: true })
  profileImageUrl?: string;

  /** 인박스 카테고리별 수신 여부 (jsonb). 미설정 카테고리는 DEFAULT_NOTIFICATION_PREFERENCES 적용 */
  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES)}'::jsonb` })
  notificationPreferences: NotificationPreferencesDto;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
