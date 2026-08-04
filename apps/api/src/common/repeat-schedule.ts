import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { withTimeout } from './with-timeout';

const logger = new Logger('RepeatSchedule');

/**
 * cron 은 발표 시각·생활 시간대 기준이라 KST 로 고정한다.
 * 미지정이면 서버 로컬을 따르므로 UTC 컨테이너에서 9시간 어긋난다.
 */
const SCHEDULE_TZ = 'Asia/Seoul';

/** 스캔 잡 보관 정책 — 완료본은 남기지 않고 실패만 최근 20건. */
const SCAN_JOB_OPTS = { removeOnComplete: true, removeOnFail: 20 } as const;

export interface RepeatSchedule {
  /** 잡 이름 = 스케줄러 ID. 프로세서가 `job.name` 으로 분기하므로 둘을 같은 값으로 둔다. */
  name: string;
  cron: string;
}

/**
 * 반복 스캔 잡을 등록한다(재기동마다 중복 등록되지 않게 upsert).
 *
 * **`queue.add(name, {}, { repeat })` 를 쓰면 안 된다** — 그 방식의 repeat 키는
 * `hash(name:jobId:endDate:tz:pattern)` 이라 **cron 을 바꾸면 새 항목이 생기고 옛 스케줄이
 * 그대로 남는다**(로컬 Redis 실측: 패턴만 바꿔 재등록 → repeatable 2개·delayed 2개).
 * 스캔이 두 벌 돌아 외부 API 호출이 두 배가 된다(알림 자체는 SET NX 선점으로 중복되지 않는다).
 * `upsertJobScheduler` 는 키가 스케줄러 ID 하나라 같은 변경에서 항목이 갱신된다.
 *
 * 옛 방식으로 등록된 잔재도 여기서 함께 지운다 — 안 지우면 배포 후에도 두 벌이 계속 돈다.
 */
export async function upsertRepeatSchedules(
  queue: Queue,
  schedules: RepeatSchedule[],
  timeoutMs: number,
): Promise<void> {
  for (const { name, cron } of schedules) {
    await withTimeout(
      queue.upsertJobScheduler(
        name,
        { pattern: cron, tz: SCHEDULE_TZ },
        { name, data: {}, opts: { ...SCAN_JOB_OPTS } },
      ),
      timeoutMs,
      `반복 잡 등록 응답 없음 (${name})`,
    );
  }

  // 정리는 부수 작업이라 실패해도 등록을 실패로 만들지 않는다 — 등록 자체는 이미 끝났고,
  // 여기서 던지면 호출부의 백오프 재시도가 "등록 실패" 로 오인 로그를 남긴다.
  try {
    await withTimeout(
      removeStaleRepeatables(queue, schedules),
      timeoutMs,
      '옛 반복 잡 조회 응답 없음',
    );
  } catch (err) {
    logger.warn(
      `옛 반복 잡 정리 실패 — 다음 기동에 다시 시도한다: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 같은 이름으로 등록된 옛 repeatable 항목을 지운다.
 *
 * 스케줄러가 만든 항목은 `key` 가 곧 스케줄러 ID(= 잡 이름)다. 같은 이름인데 키가 해시면
 * 옛 `add({ repeat })` 잔재이므로, 그 항목과 예약돼 있던 다음 실행분까지 함께 사라진다.
 */
async function removeStaleRepeatables(queue: Queue, schedules: RepeatSchedule[]): Promise<void> {
  const owned = new Set(schedules.map((s) => s.name));
  const existing = await queue.getRepeatableJobs();

  for (const entry of existing) {
    if (!owned.has(entry.name) || entry.key === entry.name) continue;
    await queue.removeRepeatableByKey(entry.key);
    logger.log(`옛 반복 잡 제거 — ${entry.name} (pattern: ${entry.pattern}, key: ${entry.key})`);
  }
}
