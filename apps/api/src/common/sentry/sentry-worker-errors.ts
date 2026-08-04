import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { WorkerHost } from '@nestjs/bullmq';
import * as Sentry from '@sentry/nestjs';
import type { Job, Worker } from 'bullmq';

/**
 * BullMQ 워커 실패를 Sentry 로 보낸다.
 *
 * SentryGlobalFilter 는 Nest 요청 파이프라인(HTTP·WS·RPC) 안의 예외만 잡는다. 잡 처리에서
 * 던진 예외는 BullMQ 가 삼켜 재시도로 돌리므로 필터를 타지 않고, 그대로 두면 재계획·알림
 * 스캔이 조용히 죽는다 — 이 서비스에서 실패가 가장 아픈 경로가 정확히 거기다.
 *
 * 프로세서마다 리스너를 다는 대신 DiscoveryService 로 WorkerHost 를 전부 찾아 한 곳에서 건다.
 * 새 프로세서가 생겨도 자동으로 포함된다.
 */
@Injectable()
export class SentryWorkerErrors implements OnApplicationBootstrap {
  private readonly logger = new Logger(SentryWorkerErrors.name);

  constructor(private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): void {
    const hosts = this.discovery
      .getProviders()
      .map((wrapper) => wrapper.instance)
      .filter((instance): instance is WorkerHost => instance instanceof WorkerHost);

    for (const host of hosts) {
      // worker 는 @Processor 가 주입한다. 아직 안 붙었으면 건너뛴다.
      const worker: Worker | undefined = host.worker;
      if (!worker) continue;

      worker.on('failed', (job: Job | undefined, err: Error) => {
        // 잡마다 스코프를 격리하지 않으면 앞선 잡의 태그가 다음 이벤트에 묻어난다.
        Sentry.withIsolationScope((scope) => {
          scope.setTags({
            'bullmq.queue': worker.name,
            'bullmq.job': job?.name ?? 'unknown',
          });
          scope.setContext('bullmq', {
            jobId: job?.id,
            attemptsMade: job?.attemptsMade,
            maxAttempts: job?.opts?.attempts ?? 1,
            data: job?.data,
          });
          Sentry.captureException(err);
        });
      });
    }

    this.logger.log(`Sentry BullMQ 실패 리스너 연결: ${hosts.length}개 워커`);
  }
}
