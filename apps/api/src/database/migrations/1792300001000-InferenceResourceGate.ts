import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InferenceResourceGate1792300001000 implements MigrationInterface {
  name = 'InferenceResourceGate1792300001000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE inference_resources (
      "resourceKey" varchar(120) PRIMARY KEY,
      device varchar(20) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'READY',
      "activeExecutionId" uuid,
      "updatedAt" timestamptz NOT NULL DEFAULT NOW()
    )`);
    await runner.query(`CREATE TABLE inference_model_executions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sequence bigserial NOT NULL UNIQUE,
      "resourceKey" varchar(120) NOT NULL,
      "requestId" varchar(200) NOT NULL,
      attempt integer NOT NULL CHECK (attempt > 0),
      workload varchar(20) NOT NULL,
      status varchar(20) NOT NULL,
      "ownerToken" uuid NOT NULL,
      "queuedAt" timestamptz NOT NULL DEFAULT NOW(),
      "waitDeadlineAt" timestamptz NOT NULL,
      "startedAt" timestamptz,
      "endedAt" timestamptz,
      "heartbeatAt" timestamptz,
      evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    )`);
    await runner.query(`CREATE INDEX "IDX_inference_executions_resource_queue"
      ON inference_model_executions ("resourceKey", status, sequence)`);
    // Defense in depth: even a future code path cannot persist two active owners per resource.
    await runner.query(`CREATE UNIQUE INDEX "IDX_inference_one_active_resource"
      ON inference_model_executions ("resourceKey")
      WHERE status IN ('RUNNING', 'DRAINING', 'RECONCILING')`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE inference_model_executions');
    await runner.query('DROP TABLE inference_resources');
  }
}
