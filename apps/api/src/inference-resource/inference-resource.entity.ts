import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { InferenceDevice } from './inference-resource.config';

export type InferenceResourceStatus = 'READY' | 'RUNNING' | 'DRAINING' | 'RECONCILING';

@Entity('inference_resources')
export class InferenceResourceEntity {
  @PrimaryColumn({ type: 'varchar', length: 120 })
  resourceKey: string;

  @Column({ type: 'varchar', length: 20 })
  device: InferenceDevice;

  @Column({ type: 'varchar', length: 20, default: 'READY' })
  status: InferenceResourceStatus;

  @Column({ type: 'uuid', nullable: true })
  activeExecutionId: string | null;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
