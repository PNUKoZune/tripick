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
import type { TasteTagDto, TasteTagValue } from '@tripick/types';
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

  /**
   * 사용자가 올린 취향 사진의 **비공개 버킷 키**.
   *
   * 컬럼명은 `photoUrls` 로 남겨 둔다(rename 마이그레이션 회피) — 담기는 값이 공개 URL 에서
   * 스토리지 키로 바뀌었을 뿐이다. 표시용 URL 은 만료되는 서명 URL 이라 DB 에 둘 수 없다.
   * `photoTags`·`disabledPhotoTags` 의 key 도 같은 스토리지 키다.
   */
  @Column({ type: 'jsonb', default: '[]', name: 'photoUrls' })
  photoKeys: string[];

  /**
   * 사진별 분석 결과 (key = 스토리지 키).
   * 사진을 추가할 때 새 사진만 분석하고, 삭제할 때는 남은 사진으로 다시 집계하기 위해 보관한다.
   */
  @Column({ type: 'jsonb', default: '{}' })
  photoTags: Record<string, TasteTagDto>;

  /**
   * 사용자가 직접 끈 사진별 태그 (key = 사진 URL).
   * 분석 결과(photoTags)는 그대로 두고 집계에서만 빼서, 다시 켜면 원래 값이 살아난다.
   */
  @Column({ type: 'jsonb', default: '{}' })
  disabledPhotoTags: Record<string, TasteTagValue[]>;

  @Column({ nullable: true })
  embeddingId?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
