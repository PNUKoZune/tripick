import { MigrationInterface, QueryRunner } from 'typeorm';

export class GenerationRequestLedger1792250000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // An old generating trip may still own a model call. Migration is deliberately fail-closed:
    // drain/verify the old workers before crossing the durable admission boundary.
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM trips WHERE status = 'generating') THEN
        RAISE EXCEPTION 'Drain and reconcile legacy generating trips before installing generation ledger';
      END IF;
    END $$`);
    await queryRunner.query(`CREATE TABLE generation_requests (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "admissionOrder" bigserial NOT NULL, "tripId" uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      "userId" varchar NOT NULL, "requestKey" varchar(128) NOT NULL, "inputHash" varchar(64) NOT NULL,
      state varchar NOT NULL DEFAULT 'queued', version integer NOT NULL DEFAULT 0,
      attempt integer NOT NULL DEFAULT 0, "maxAttempts" integer NOT NULL DEFAULT 3,
      "publishedAt" timestamptz, "startedAt" timestamptz, "finishedAt" timestamptz, error text, "reconciliationEvidence" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_generation_state" CHECK (state IN ('queued','running','cancel_requested','cancelled','reconciling','failed','succeeded'))
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_generation_request_key" ON generation_requests ("userId", "requestKey")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_generation_user_unfinished" ON generation_requests ("userId") WHERE state IN ('queued','running','cancel_requested','reconciling')`);
    await queryRunner.query(`CREATE INDEX "IDX_generation_publish_order" ON generation_requests ("admissionOrder")`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE generation_requests');
  }
}
