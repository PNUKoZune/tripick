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
 * - verify_email: 24h, 사용 시 user.emailVerifiedAt 채움 + 이 행의 대기 비밀번호를 승격
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

  /**
   * 이 토큰을 소비할 때 활성화할 bcrypt hash (verify_email 전용, 없으면 인증만 처리).
   *
   * 대기 비밀번호를 계정이 아니라 **토큰에** 두는 이유: 계정에 두면 같은 이메일로 들어온
   * 여러 가입 신청이 한 칸을 두고 다투게 되고, 어느 쪽이 이기든 "링크를 누른 사람이 신청한
   * 것과 다른 비밀번호"가 활성화될 수 있다. 계정에 먼저 심어 두는 쪽이 이기게 하면 남의
   * 이메일을 선점해 두고 주인이 자기 가입 링크를 누르는 순간 공격자 비밀번호가 켜지고,
   * 나중 신청이 이기게 하면 주인이 기다리던 링크의 의미가 바뀐다.
   * 토큰마다 자기 신청의 비밀번호를 들고 있으면 **누른 링크의 비밀번호**만 켜진다.
   */
  @Column({ type: 'varchar', nullable: true })
  pendingPasswordHash?: string | null;

  /** 사용된(소비된) 시각. null = 아직 사용 가능. */
  @Column({ type: 'timestamptz', nullable: true })
  consumedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;
}
