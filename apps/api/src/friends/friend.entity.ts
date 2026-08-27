import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';
import type { FriendStatus } from '@tripick/types';

@Entity('friends')
@Index(['ownerId', 'handle'], { unique: true })
export class FriendEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ownerId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  owner: UserEntity;

  @Column({ type: 'uuid', nullable: true })
  friendUserId: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'friendUserId' })
  friendUser: UserEntity | null;

  @Column()
  nickname: string;

  @Column()
  handle: string;

  @Column({ default: '#3182F6' })
  color: string;

  @Column()
  initial: string;

  @Column({ type: 'varchar', nullable: true })
  emoji: string | null;

  @Column({ type: 'varchar', nullable: true })
  statusMessage: string | null;

  @Column({ default: 'accepted' })
  status: FriendStatus;

  @Column({ default: false })
  pinned: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
