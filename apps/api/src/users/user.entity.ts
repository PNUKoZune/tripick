import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  kakaoId: string;

  @Column()
  nickname: string;

  @Column({ nullable: true })
  profileImageUrl?: string;

  @Column({ nullable: true, unique: true })
  email?: string;

  /** Firebase FCM 디바이스 토큰 */
  @Column({ nullable: true })
  fcmToken?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
