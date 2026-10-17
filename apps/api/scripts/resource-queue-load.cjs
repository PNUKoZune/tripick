/* Policy-only measurement: no model calls, no GPU performance claims. */
/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS measurement runner */
const { randomUUID } = require('node:crypto');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const { Queue, QueueEvents, Worker } = require('bullmq');

if (!process.env.RESOURCE_TEST_REDIS_URL)
  throw new Error('RESOURCE_TEST_REDIS_URL must name an isolated local Redis instance');
const url = new URL(process.env.RESOURCE_TEST_REDIS_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('Use an isolated local Redis instance for this measurement');
}
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  maxRetriesPerRequest: null,
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] * 100) / 100;
}

async function scenario(users, workerCount, mixed) {
  const name = `resource-policy-test-${randomUUID()}`;
  const queue = new Queue(name, { connection });
  // waitUntilFinished registers one temporary closing listener per concurrent waiter.
  queue.setMaxListeners(25);
  const events = new QueueEvents(name, { connection });
  const timeline = [];
  const workers = [];
  const loop = monitorEventLoopDelay({ resolution: 10 });
  let active = 0;
  let maximumActive = 0;
  const cpu = process.cpuUsage();
  const start = performance.now();
  loop.enable();
  try {
    await events.waitUntilReady();
    await queue.setGlobalConcurrency(1);
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(
        new Worker(
          name,
          async (job) => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            const item = {
              user: job.data.user,
              worker: i,
              waitMs: Date.now() - job.timestamp,
              startedMs: Math.round(performance.now() - start),
            };
            timeline.push(item);
            const runStart = performance.now();
            await delay(job.data.durationMs);
            item.runMs = performance.now() - runStart;
            item.endedMs = Math.round(performance.now() - start);
            active -= 1;
            return job.data.user;
          },
          { connection, concurrency: 4 },
        ),
      );
    }
    await Promise.all(workers.map((worker) => worker.waitUntilReady()));
    const jobs = [];
    for (let user = 0; user < users; user += 1) {
      jobs.push(
        await queue.add('policy-stub', { user, durationMs: mixed && user % 4 === 0 ? 80 : 20 }),
      );
    }
    await Promise.all(jobs.map((job) => job.waitUntilFinished(events, 20_000)));
    const fifo = timeline.every((row, i) => row.user === i);
    if (maximumActive !== 1 || !fifo || timeline.length !== users)
      throw new Error('Queue policy invariant violated');
    const used = process.cpuUsage(cpu);
    return {
      users,
      workers: workerCount,
      workload: mixed ? 'mixed-20-80ms-stub' : 'equal-20ms-stub',
      effectiveGlobalConcurrency: await queue.getGlobalConcurrency(),
      maximumActive,
      fifo,
      completed: timeline.length,
      queueWaitP50Ms: quantile(
        timeline.map((x) => x.waitMs),
        0.5,
      ),
      queueWaitP95Ms: quantile(
        timeline.map((x) => x.waitMs),
        0.95,
      ),
      runP50Ms: quantile(
        timeline.map((x) => x.runMs),
        0.5,
      ),
      runP95Ms: quantile(
        timeline.map((x) => x.runMs),
        0.95,
      ),
      eventLoopP95Ms: Math.round(loop.percentile(95) / 1e4) / 100,
      cpuUserMs: used.user / 1000,
      cpuSystemMs: used.system / 1000,
      processRssBytes: process.memoryUsage().rss,
      timeline,
    };
  } finally {
    loop.disable();
    await Promise.all(workers.map((worker) => worker.close()));
    await events.close();
    await queue.obliterate();
    await queue.close();
  }
}

(async () => {
  const results = [];
  for (const users of [1, 5, 20]) {
    for (const workers of [1, 2]) {
      for (const mixed of [false, true]) results.push(await scenario(users, workers, mixed));
    }
  }
  process.stdout.write(
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        scope:
          'isolated Redis, real BullMQ workers, timer stub; excludes GPU/model and DB admission',
        results,
      },
      null,
      2,
    ) + '\n',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
