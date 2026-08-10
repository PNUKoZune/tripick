import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type EmailTokenPurpose = 'verify_email' | 'reset_password';

/**
 * 이메일로 보내는 1회용 토큰. 본문에는 raw 토큰을, DB 에는 SHA-256 hash 만 저장한다.
 *
 * - verify_email: 24h, 사용 시 user.emailVerifiedAt 채움
 * - reset_password: 1h, 사용 시 user.passwordHash 교체 + 같은 사용자 다른 reset 토큰 만료
 */
@Entity('email_tokens')
export class EmailTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ type: 'varchar', length: 32 })
  purpose: EmailTokenPurpose;

  @Index({ unique: true })
  @Column()
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** 사용된(소비된) 시각. null = 아직 사용 가능. */
  @Column({ type: 'timestamptz', nullable: true })
  consumedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;
}
