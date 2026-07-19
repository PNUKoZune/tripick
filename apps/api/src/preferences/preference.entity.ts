import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';
import type { TasteTagDto } from '@tripick/types';
import type { PreferenceProfileDto } from '@tripick/types';

@Entity('preferences')
export class PreferenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  userId: string;

  @OneToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column({ type: 'jsonb', default: '{}' })
  tasteTags: TasteTagDto;

  @Column({ type: 'jsonb', default: '{}' })
  profile: PreferenceProfileDto;

  /** 사용자가 올린 취향 원본 사진 URL (Object Storage) */
  @Column({ type: 'jsonb', default: '[]' })
  photoUrls: string[];

  /**
   * 사진별 분석 결과 (key = 사진 URL).
   * 사진을 추가할 때 새 사진만 분석하고, 삭제할 때는 남은 사진으로 다시 집계하기 위해 보관한다.
   */
  @Column({ type: 'jsonb', default: '{}' })
  photoTags: Record<string, TasteTagDto>;

  @Column({ nullable: true })
  embeddingId?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
