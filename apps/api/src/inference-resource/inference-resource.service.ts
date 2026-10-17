import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import { assertInferenceExecutionRunnable, getInferenceExecutionContext } from './inference-execution-context';
import {
  readInferenceResourceConfig,
  type InferenceResourceConfig,
  type InferenceWorkload,
} from './inference-resource.config';
import { InferenceResourceError, shouldPropagateInferenceError } from './inference-resource.errors';
import type { InferenceResourceEntity } from './inference-resource.entity';
import { isConfirmedConnectionFailure } from './inference-transport-outcome';

export interface ReconciliationEvidence {
  resourceKey: string;
  executionId: string;
  actor: string;
  confirmation: 'model-server-restarted' | 'remote-completion-confirmed';
  /** Operator log, restart identifier, or provider request-status evidence. */
  reference: string;
  /** Remote termination alone cannot fence a paused executor which has not dispatched yet. */
  ownerStopped: true;
  ownerStopReference: string;
}

/**
 * Cross-process execution gate, without inference-server fencing support.
 * Time passing never grants ownership; reconciliation also requires the prior executor to stop.
 */
@Injectable()
export class InferenceResourceService implements OnModuleDestroy {
  private readonly logger = new Logger(InferenceResourceService.name);
  readonly settings: InferenceResourceConfig;
  private readonly owned = new Map<string, string>();
  private readonly executor = { instanceId: randomUUID(), hostname: hostname(), pid: process.pid };

  constructor(private readonly db: DataSource, config: ConfigService) {
    this.settings = readInferenceResourceConfig(config);
  }

  async execute<T>(workload: InferenceWorkload, operation: () => Promise<T>): Promise<T> {
    const route = this.settings.routes[workload];
    const context = getInferenceExecutionContext();
    const id = randomUUID();
    const owner = randomUUID();
    const requestId = context?.requestId ?? `direct:${id}`;
    const attempt = context?.attempt ?? 1;
    if (!requestId || requestId.length > 200 || !Number.isSafeInteger(attempt) || attempt < 1) {
      throw new Error('Invalid inference execution context');
    }

    await assertInferenceExecutionRunnable();
    try {
      await this.enqueue(workload, id, owner, requestId, attempt);
      await this.waitForOwnership(route.resourceKey, id, owner);
    } catch (error) {
      if (shouldPropagateInferenceError(error)) throw error;
      throw new InferenceResourceError('RESOURCE_RECONCILIATION_REQUIRED', route.resourceKey, id);
    }
    this.owned.set(id, route.resourceKey);

    // Heartbeats diagnose worker death; they are not leases which permit automatic takeover.
    let heartbeatPending = false;
    const heartbeat = setInterval(() => {
      if (heartbeatPending) return;
      heartbeatPending = true;
      void this.db.query(
        `UPDATE inference_model_executions SET "heartbeatAt" = NOW()
         WHERE id = $1 AND "ownerToken" = $2 AND status = 'RUNNING'`,
        [id, owner],
      ).catch(() => this.logger.error(`Inference heartbeat failed for ${id}`))
        .finally(() => { heartbeatPending = false; });
    }, this.settings.heartbeatMs);
    heartbeat.unref();

    try {
      try {
        await assertInferenceExecutionRunnable();
      } catch (error) {
        // Cancellation after FIFO waiting is checked again before any model HTTP dispatch.
        try {
          await this.finish(route.resourceKey, id, owner, 'HTTP_REJECTED', {
            outcome: 'no-dispatch', reason: 'execution-guard-rejected',
          });
        } catch {
          throw new InferenceResourceError('MODEL_COMPLETION_UNCERTAIN', route.resourceKey, id);
        }
        throw error;
      }
      // Best effort only: a process can pause after this check and before HTTP dispatch.
      // Operations must confirm this executor stopped before reconciling its ownership.
      await this.assertOwnershipBeforeDispatch(route.resourceKey, id, owner);
      let result: T;
      try {
        // The actual HTTP request starts only AFTER the locked database ownership transition.
        result = await operation();
      } catch (error) {
        const connectionNotEstablished = isConfirmedConnectionFailure(error);
        if (this.confirmedHttpRejection(error) || connectionNotEstablished) {
          try {
            await this.finish(route.resourceKey, id, owner, 'HTTP_REJECTED', {
              outcome: connectionNotEstablished ? 'no-dispatch' : 'http-rejection',
              reason: connectionNotEstablished ? 'connection-not-established' : 'http-preflight-rejection',
              status: this.httpStatus(error),
            });
          } catch {
            throw new InferenceResourceError('MODEL_COMPLETION_UNCERTAIN', route.resourceKey, id);
          }
          throw error;
        }
        await this.drain(route.resourceKey, id, owner, 'transport-or-server-completion-unknown');
        throw new InferenceResourceError('MODEL_COMPLETION_UNCERTAIN', route.resourceKey, id);
      }
      try {
        await this.finish(route.resourceKey, id, owner, 'SUCCEEDED', {
          outcome: 'complete-http-response', completedAt: new Date().toISOString(),
        });
      } catch {
        // A completed response is not enough to grant another caller if DB fencing failed.
        throw new InferenceResourceError('MODEL_COMPLETION_UNCERTAIN', route.resourceKey, id);
      }
      return result;
    } finally {
      clearInterval(heartbeat);
      this.owned.delete(id);
    }
  }

  private async enqueue(
    workload: InferenceWorkload, id: string, owner: string, requestId: string, attempt: number,
  ): Promise<void> {
    const route = this.settings.routes[workload];
    const outcome = await this.db.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO inference_resources ("resourceKey", device, status, "updatedAt")
         VALUES ($1, $2, 'READY', NOW()) ON CONFLICT ("resourceKey") DO NOTHING`,
        [route.resourceKey, route.device],
      );
      const resource = await this.lock(manager, route.resourceKey);
      if (resource.device !== route.device) {
        throw new Error(`Database device configuration conflicts for resource ${route.resourceKey}`);
      }
      if (await this.blocked(manager, resource)) return 'blocked' as const;
      await this.expireWaiters(manager, route.resourceKey);
      const rows: Array<{ count: string }> = await manager.query(
        `SELECT COUNT(*)::text AS count FROM inference_model_executions
         WHERE "resourceKey" = $1 AND status = 'WAITING'`, [route.resourceKey],
      );
      if (Number(rows[0]?.count ?? 0) >= this.settings.maxWaiting) return 'full' as const;
      await manager.query(
        `INSERT INTO inference_model_executions
         (id, "resourceKey", "requestId", attempt, workload, status, "ownerToken", "queuedAt", "waitDeadlineAt", evidence)
         VALUES ($1, $2, $3, $4, $5, 'WAITING', $6, NOW(),
           NOW() + $7 * INTERVAL '1 millisecond', $8::jsonb)`,
        [id, route.resourceKey, requestId, attempt, workload, owner, this.settings.waitTimeoutMs,
          JSON.stringify({ device: route.device, executor: this.executor })],
      );
      return 'queued' as const;
    });
    if (outcome === 'blocked') {
      throw new InferenceResourceError('RESOURCE_RECONCILIATION_REQUIRED', route.resourceKey);
    }
    if (outcome === 'full') throw new InferenceResourceError('RESOURCE_QUEUE_FULL', route.resourceKey);
  }

  private async waitForOwnership(resourceKey: string, id: string, owner: string): Promise<void> {
    while (true) {
      try {
        await assertInferenceExecutionRunnable();
      } catch (error) {
        await this.db.query(
          `UPDATE inference_model_executions SET status = 'EXPIRED', "endedAt" = NOW(),
           evidence = evidence || '{"reason":"execution-guard-rejected-before-dispatch"}'::jsonb
           WHERE id = $1 AND "ownerToken" = $2 AND status = 'WAITING'`, [id, owner],
        );
        throw error;
      }
      const outcome = await this.db.transaction(async (manager) => {
        const resource = await this.lock(manager, resourceKey);
        if (await this.blocked(manager, resource)) {
          await manager.query(
            `UPDATE inference_model_executions SET status = 'EXPIRED', "endedAt" = NOW(),
             evidence = evidence || '{"reason":"resource-reconciliation-required"}'::jsonb
             WHERE id = $1 AND status = 'WAITING'`, [id],
          );
          return 'blocked' as const;
        }
        await this.expireWaiters(manager, resourceKey);
        const own: Array<{ status: string }> = await manager.query(
          `SELECT status FROM inference_model_executions WHERE id = $1 AND "ownerToken" = $2`,
          [id, owner],
        );
        if (own[0]?.status !== 'WAITING') return 'expired' as const;
        if (resource.activeExecutionId || resource.status !== 'READY') return 'wait' as const;
        const first: Array<{ id: string }> = await manager.query(
          `SELECT id FROM inference_model_executions
           WHERE "resourceKey" = $1 AND status = 'WAITING' ORDER BY sequence LIMIT 1`, [resourceKey],
        );
        if (first[0]?.id !== id) return 'wait' as const;
        await manager.query(
          `UPDATE inference_model_executions SET status = 'RUNNING', "startedAt" = NOW(), "heartbeatAt" = NOW()
           WHERE id = $1 AND "ownerToken" = $2 AND status = 'WAITING'`, [id, owner],
        );
        await manager.query(
          `UPDATE inference_resources SET status = 'RUNNING', "activeExecutionId" = $2, "updatedAt" = NOW()
           WHERE "resourceKey" = $1`, [resourceKey, id],
        );
        return 'acquired' as const;
      });
      if (outcome === 'acquired') return;
      if (outcome === 'blocked') {
        throw new InferenceResourceError('RESOURCE_RECONCILIATION_REQUIRED', resourceKey, id);
      }
      if (outcome === 'expired') throw new InferenceResourceError('RESOURCE_WAIT_TIMEOUT', resourceKey, id);
      await new Promise<void>((resolve) => setTimeout(resolve, this.settings.pollMs));
    }
  }

  private async lock(manager: EntityManager, resourceKey: string): Promise<InferenceResourceEntity> {
    const rows: InferenceResourceEntity[] = await manager.query(
      `SELECT * FROM inference_resources WHERE "resourceKey" = $1 FOR UPDATE`, [resourceKey],
    );
    const resource = rows[0];
    if (!resource) throw new Error(`Missing inference resource ${resourceKey}`);
    return resource;
  }

  private async assertOwnershipBeforeDispatch(resourceKey: string, id: string, owner: string): Promise<void> {
    try {
      const stillOwned = await this.db.transaction(async (manager) => {
        const resource = await this.lock(manager, resourceKey);
        if (resource.status !== 'RUNNING' || resource.activeExecutionId !== id) return false;
        const rows: Array<{ id: string }> = await manager.query(
          `SELECT id FROM inference_model_executions
           WHERE id = $1 AND "ownerToken" = $2 AND status = 'RUNNING'`, [id, owner],
        );
        return rows.length === 1;
      });
      if (!stillOwned) throw new InferenceResourceError('RESOURCE_RECONCILIATION_REQUIRED', resourceKey, id);
    } catch (error) {
      if (error instanceof InferenceResourceError) throw error;
      throw new InferenceResourceError('RESOURCE_RECONCILIATION_REQUIRED', resourceKey, id);
    }
  }

  private async expireWaiters(manager: EntityManager, resourceKey: string): Promise<void> {
    await manager.query(
      `UPDATE inference_model_executions SET status = 'EXPIRED', "endedAt" = NOW(),
       evidence = evidence || '{"reason":"wait-deadline"}'::jsonb
       WHERE "resourceKey" = $1 AND status = 'WAITING' AND "waitDeadlineAt" <= NOW()`, [resourceKey],
    );
  }

  /** Commits quarantine before reporting an error; throwing inside this transaction would roll it back. */
  private async blocked(manager: EntityManager, resource: InferenceResourceEntity): Promise<boolean> {
    if (resource.status === 'DRAINING' || resource.status === 'RECONCILING') return true;
    if (resource.status === 'READY' && !resource.activeExecutionId) return false;
    const alive: Array<{ id: string }> = await manager.query(
      `SELECT id FROM inference_model_executions WHERE id = $1 AND status = 'RUNNING'
       AND "heartbeatAt" >= NOW() - $2 * INTERVAL '1 millisecond'`,
      [resource.activeExecutionId, this.settings.staleAfterMs],
    );
    if (resource.activeExecutionId && alive.length === 1) return false;
    await manager.query(
      `UPDATE inference_resources SET status = 'RECONCILING', "updatedAt" = NOW()
       WHERE "resourceKey" = $1`, [resource.resourceKey],
    );
    if (resource.activeExecutionId) {
      await manager.query(
        `UPDATE inference_model_executions SET status = 'RECONCILING',
         evidence = evidence || '{"reason":"owner-heartbeat-stale-no-auto-release"}'::jsonb
         WHERE id = $1 AND status IN ('RUNNING', 'DRAINING')`, [resource.activeExecutionId],
      );
    }
    return true;
  }

  private async finish(
    resourceKey: string, id: string, owner: string,
    status: 'SUCCEEDED' | 'HTTP_REJECTED', evidence: Record<string, unknown>,
  ): Promise<void> {
    await this.db.transaction(async (manager) => {
      const resource = await this.lock(manager, resourceKey);
      if (resource.activeExecutionId !== id) {
        throw new InferenceResourceError('RESOURCE_RECONCILIATION_REQUIRED', resourceKey, id);
      }
      const changed: Array<{ id: string }> = await manager.query(
        `WITH changed AS (UPDATE inference_model_executions
         SET status = $3, "endedAt" = NOW(), evidence = evidence || $4::jsonb
         WHERE id = $1 AND "ownerToken" = $2 AND status IN ('RUNNING', 'DRAINING', 'RECONCILING') RETURNING id)
         SELECT id FROM changed`,
        [id, owner, status, JSON.stringify(evidence)],
      );
      if (changed.length !== 1) throw new Error('Inference ownership fencing failed');
      await manager.query(
        `UPDATE inference_resources SET status = 'READY', "activeExecutionId" = NULL, "updatedAt" = NOW()
         WHERE "resourceKey" = $1 AND "activeExecutionId" = $2`, [resourceKey, id],
      );
    });
  }

  private async drain(resourceKey: string, id: string, owner: string, reason: string): Promise<void> {
    try {
      await this.db.transaction(async (manager) => {
        const resource = await this.lock(manager, resourceKey);
        if (resource.activeExecutionId !== id) return;
        await manager.query(
          `UPDATE inference_model_executions SET status = 'DRAINING',
           evidence = evidence || $3::jsonb
           WHERE id = $1 AND "ownerToken" = $2 AND status IN ('RUNNING', 'RECONCILING')`,
          [id, owner, JSON.stringify({ reason, observedAt: new Date().toISOString() })],
        );
        await manager.query(
          `UPDATE inference_resources SET status = 'DRAINING', "updatedAt" = NOW() WHERE "resourceKey" = $1`,
          [resourceKey],
        );
      });
    } catch {
      // An unavailable database leaves RUNNING ownership intact; it never becomes READY by TTL.
      this.logger.error(`Could not persist DRAINING state for inference execution ${id}`);
    }
  }

  private httpStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null || !('response' in error)) return undefined;
    const response = error.response;
    if (typeof response !== 'object' || response === null || !('status' in response)) return undefined;
    return typeof response.status === 'number' ? response.status : undefined;
  }

  private confirmedHttpRejection(error: unknown): boolean {
    const status = this.httpStatus(error);
    // A proxy 5xx/504 does not establish that inference on its upstream stopped.
    return status !== undefined && [400, 401, 403, 404, 405, 406, 413, 414, 415, 422, 429].includes(status);
  }

  /** Operations-only method. No controller deliberately exposes this capability. */
  async reconcile(input: ReconciliationEvidence): Promise<void> {
    if (input.ownerStopped !== true || typeof input.ownerStopReference !== 'string' ||
        input.ownerStopReference.trim().length < 8 || input.ownerStopReference.length > 4000) {
      throw new Error('Reconciliation requires previous owner process termination confirmation and concrete owner-stop evidence');
    }
    if (!input.actor.trim() || input.actor.length > 200 || input.reference.trim().length < 8 ||
        input.reference.length > 4000 ||
        !['model-server-restarted', 'remote-completion-confirmed'].includes(input.confirmation)) {
      throw new Error('Reconciliation requires an operator and concrete restart/completion evidence');
    }
    await this.db.transaction(async (manager) => {
      const resource = await this.lock(manager, input.resourceKey);
      await this.blocked(manager, resource);
      const current = await this.lock(manager, input.resourceKey);
      if (current.activeExecutionId !== input.executionId ||
          !['DRAINING', 'RECONCILING'].includes(current.status)) {
        throw new Error('Only the currently quarantined execution can be reconciled');
      }
      const changed: Array<{ id: string }> = await manager.query(
        `WITH changed AS (UPDATE inference_model_executions SET status = 'RECONCILED', "endedAt" = NOW(),
         evidence = evidence || $2::jsonb WHERE id = $1
         AND status IN ('DRAINING', 'RECONCILING') RETURNING id) SELECT id FROM changed`,
        [input.executionId, JSON.stringify({ reconciliation: {
          actor: input.actor.trim(), confirmation: input.confirmation,
          reference: input.reference.trim(), recordedAt: new Date().toISOString(),
          ownerStopped: true, ownerStopReference: input.ownerStopReference.trim(),
        } })],
      );
      if (changed.length !== 1) throw new Error('Execution reconciliation fencing failed');
      await manager.query(
        `UPDATE inference_resources SET status = 'READY', "activeExecutionId" = NULL, "updatedAt" = NOW()
         WHERE "resourceKey" = $1`, [input.resourceKey],
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.owned].map(([id, resourceKey]) =>
      // The process is stopping, but its remote HTTP request can remain in flight.
      this.db.query(
        `UPDATE inference_resources SET status = 'DRAINING', "updatedAt" = NOW()
         WHERE "resourceKey" = $1 AND "activeExecutionId" = $2`, [resourceKey, id],
      ).then(() => this.db.query(
        `UPDATE inference_model_executions SET status = 'DRAINING',
         evidence = evidence || '{"reason":"owner-process-shutdown"}'::jsonb
         WHERE id = $1 AND status = 'RUNNING'`, [id],
      )),
    ));
  }
}
