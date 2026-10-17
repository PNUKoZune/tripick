import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { withTimeout } from '../common/with-timeout';
import {
  TRIP_GENERATION_QUEUE,
  TRIP_GENERATION_QUEUE_TIMEOUT_MS,
} from './trip-generation.constants';
import { TripGenerationProcessor } from './trip-generation.processor';

/** Worker autorun is disabled until the shared queue limit has been verified. */
@Injectable()
export class TripGenerationQueuePolicy implements OnApplicationBootstrap {
  private readonly logger = new Logger(TripGenerationQueuePolicy.name);

  constructor(
    @InjectQueue(TRIP_GENERATION_QUEUE) private readonly queue: Queue,
    private readonly processor: TripGenerationProcessor,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const configured = Number(this.config.get('TRIP_GENERATION_GLOBAL_CONCURRENCY', 1));
    if (!Number.isSafeInteger(configured) || configured < 1 || configured > 20) {
      throw new Error('TRIP_GENERATION_GLOBAL_CONCURRENCY must be an integer from 1 to 20');
    }
    await withTimeout(
      this.configure(configured),
      TRIP_GENERATION_QUEUE_TIMEOUT_MS,
      'Trip generation global concurrency configuration timed out',
    );
    // run() lives until shutdown. Nest/BullMQ owns the worker shutdown lifecycle.
    void this.processor.worker.run().catch((error: unknown) => {
      this.logger.error(
        `Trip generation worker stopped: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private async configure(configured: number): Promise<void> {
    const existing = await this.queue.getGlobalConcurrency();
    // Replicas must agree. An old replica must never silently undo a deliberate limit change.
    if (existing !== null && existing !== configured) {
      throw new Error(
        `Trip generation queue limit mismatch: configured=${configured}, effective=${existing}`,
      );
    }
    // BullMQ 5 stores setGlobalConcurrency in meta.concurrency. HSETNX is its atomic
    // initialization equivalent: concurrent first-start replicas cannot overwrite one another.
    const client = await this.queue.client;
    await client.hsetnx(this.queue.keys.meta!, 'concurrency', String(configured));
    const effective = await this.queue.getGlobalConcurrency();
    if (effective !== configured)
      throw new Error('Trip generation global concurrency verification failed');
    this.logger.log(
      JSON.stringify({ event: 'trip_generation_queue_policy', configured, effective }),
    );
  }
}
