import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { redisConnection } from '../../common/redis.config';
import { withTimeout } from '../../common/with-timeout';
import {
  SNAPSHOT_TTL_SECONDS,
  type PlanningSnapshot,
  type StoredPlanningCandidate,
} from './planning.contract';

/** Shared Redis storage: snapshots survive API instance changes and expire automatically. */
@Injectable()
export class PlanningSnapshotStore implements OnModuleDestroy {
  private readonly redis: Redis;
  private connecting: Promise<void> | undefined;

  constructor(config: ConfigService) {
    this.redis = new Redis(
      redisConnection(config, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      }),
    );
    this.redis.on('error', () => undefined);
  }

  async putSnapshot(snapshot: PlanningSnapshot): Promise<void> {
    await this.run(async () => {
      await this.redis.set(
        this.key('snapshot', snapshot.snapshotId),
        JSON.stringify(snapshot),
        'EX',
        SNAPSHOT_TTL_SECONDS,
      );
    });
  }

  async getSnapshot(id: string): Promise<PlanningSnapshot | null> {
    return this.read<PlanningSnapshot>(this.key('snapshot', id));
  }

  async putCandidate(candidate: StoredPlanningCandidate, remainingSeconds: number): Promise<void> {
    await this.run(async () => {
      // A snapshot cannot accumulate an unbounded number of stored drafts.
      const countKey = this.key('count', candidate.snapshotId);
      const stored = await this.redis.eval(
        "local count=redis.call('incr',KEYS[1]); if count==1 then redis.call('expire',KEYS[1],ARGV[1]) end; if count>100 then return 0 end; redis.call('set',KEYS[2],ARGV[2],'EX',ARGV[1]); return 1",
        2,
        countKey,
        this.key('candidate', candidate.evaluation.candidateId),
        remainingSeconds,
        JSON.stringify(candidate),
      );
      if (stored !== 1)
        throw new ServiceUnavailableException(
          'Snapshot candidate limit reached; create a new context',
        );
    });
  }

  async getCandidate(id: string): Promise<StoredPlanningCandidate | null> {
    return this.read<StoredPlanningCandidate>(this.key('candidate', id));
  }

  async acquire(id: string, token: string): Promise<boolean> {
    return this.run(
      async () => (await this.redis.set(this.key('running', id), token, 'EX', 10, 'NX')) === 'OK',
    );
  }

  async release(id: string, token: string): Promise<void> {
    await this.run(async () => {
      await this.redis.eval(
        "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        this.key('running', id),
        token,
      );
    });
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  private key(kind: string, id: string): string {
    return `planning:v1:${kind}:${id}`;
  }

  private async read<T>(key: string): Promise<T | null> {
    return this.run(async () => {
      const value = await this.redis.get(key);
      return value ? (JSON.parse(value) as T) : null;
    });
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await withTimeout(
        (async () => {
          if (this.redis.status === 'wait' || this.redis.status === 'end') {
            this.connecting ??= this.redis.connect().finally(() => {
              this.connecting = undefined;
            });
          }
          if (this.connecting) await this.connecting;
          return operation();
        })(),
        1500,
        'Planning snapshot storage timeout',
      );
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Planning snapshot storage unavailable');
    }
  }
}
