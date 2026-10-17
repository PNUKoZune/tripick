import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { InferenceWorkload } from './inference-resource.config';

export type InferenceModelExecutionStatus =
  | 'WAITING' | 'RUNNING' | 'SUCCEEDED' | 'HTTP_REJECTED'
  | 'EXPIRED' | 'DRAINING' | 'RECONCILING' | 'RECONCILED';

@Entity('inference_model_executions')
@Index('IDX_inference_executions_resource_queue', ['resourceKey', 'status', 'sequence'])
@Index('IDX_inference_one_active_resource', ['resourceKey'], {
  unique: true,
  where: "status IN ('RUNNING', 'DRAINING', 'RECONCILING')",
})
export class InferenceModelExecutionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint', generated: 'increment', unique: true })
  sequence: string;

  @Column({ type: 'varchar', length: 120 })
  resourceKey: string;

  @Column({ type: 'varchar', length: 200 })
  requestId: string;

  @Column({ type: 'integer' })
  attempt: number;

  @Column({ type: 'varchar', length: 20 })
  workload: InferenceWorkload;

  @Column({ type: 'varchar', length: 20 })
  status: InferenceModelExecutionStatus;

  @Column({ type: 'uuid' })
  ownerToken: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  queuedAt: Date;

  @Column({ type: 'timestamptz' })
  waitDeadlineAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  evidence: Record<string, unknown>;
}
