import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Refresh token whitelist. 토큰 자체는 JWT 라 stateless 검증 가능하지만,
 * 폐기·rotation·reuse detection 을 위해 hash 만 DB 에 저장.
 *
 * Rotation 규칙:
 * - 새 access/refresh 발급 시 `replacedAt` 채우고 동일 row 비활성화
 * - 옛 토큰으로 다시 refresh 시도하면 reuse → 해당 user 의 모든 active row revoke (탈취 대응)
 */
@Entity('refresh_tokens')
@Index(['userId', 'revokedAt'])
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  /** SHA-256 hex of the raw refresh token string */
  @Index({ unique: true })
  @Column()
  tokenHash: string;

  /** 가족 ID — rotation chain 추적. 첫 발급 시 자기 자신 id 와 동일. reuse detection 단위. */
  @Index()
  @Column()
  familyId: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** rotation 으로 새 토큰으로 교체된 시각. null = 아직 유효. */
  @Column({ type: 'timestamptz', nullable: true })
  replacedAt?: Date;

  /** revoke (logout/reuse detection) 된 시각. null = 아직 유효. */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt?: Date;

  /** 발급 시점의 클라이언트 정보 (디버깅·세션 관리 UI 용) */
  @Column({ nullable: true })
  userAgent?: string;

  @Column({ nullable: true })
  ipAddress?: string;

  @CreateDateColumn()
  createdAt: Date;
}
