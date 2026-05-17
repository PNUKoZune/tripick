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

  @Column({ nullable: true })
  embeddingId?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
