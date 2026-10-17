import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TripEntity } from '../trips/trip.entity';
import type { TripGenerationRequestState } from '@tripick/types';

export const UNFINISHED_GENERATION_STATES = ['queued', 'running', 'cancel_requested', 'reconciling'] as const;

/** The request, admission slot and durable publish intent have one transactional owner. */
@Entity('generation_requests')
@Index('UQ_generation_request_key', ['userId', 'requestKey'], { unique: true })
@Index('UQ_generation_user_unfinished', ['userId'], {
  unique: true,
  where: `state IN ('queued', 'running', 'cancel_requested', 'reconciling')`,
})
@Index('IDX_generation_publish_order', ['admissionOrder'])
export class GenerationRequestEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'bigint', generated: 'increment' }) admissionOrder: string;
  @Column({ type: 'uuid' }) tripId: string;
  @ManyToOne(() => TripEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tripId' }) trip: TripEntity;
  @Column({ type: 'varchar' }) userId: string;
  @Column({ type: 'varchar', length: 128 }) requestKey: string;
  @Column({ type: 'varchar', length: 64 }) inputHash: string;
  @Column({ type: 'varchar', default: 'queued' }) state: TripGenerationRequestState;
  @Column({ type: 'integer', default: 0 }) version: number;
  @Column({ type: 'integer', default: 0 }) attempt: number;
  @Column({ type: 'integer', default: 3 }) maxAttempts: number;
  @Column({ type: 'timestamptz', nullable: true }) publishedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) startedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) finishedAt: Date | null;
  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ type: 'text', nullable: true }) reconciliationEvidence: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
