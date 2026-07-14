import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * FCM 디바이스 토큰 (사용자 1명 : 토큰 N개).
 * 기존 users.fcmToken 단일 컬럼을 대체 — 기기 여러 대 로그인 지원 + 만료 토큰 개별 정리 가능.
 * 토큰은 전역 유일: 같은 기기가 다른 계정으로 재로그인하면 소유 userId 만 갱신된다.
 */
@Entity('fcm_tokens')
export class FcmTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index({ unique: true })
  @Column()
  token: string;

  /** 'android' | 'ios' | 'web' — 진단·세분화용. 없어도 발송에는 지장 없음. */
  @Column({ type: 'varchar', nullable: true })
  platform?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
