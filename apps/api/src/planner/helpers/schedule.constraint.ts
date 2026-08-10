import { Injectable } from '@nestjs/common';
import {
  MINUTES_PER_DAY,
  getAwakeWindow,
  getKstMinutes,
  minutesSinceWake,
  type AwakeWindow,
} from '@tripick/utils';
import type { ItineraryItemDto } from '@tripick/types';

interface ScheduleBounds {
  wakeTime: string;
  sleepTime: string;
}

@Injectable()
export class ScheduleConstraint {
  apply(
    items: ItineraryItemDto[],
    bounds: ScheduleBounds = { wakeTime: '07:00', sleepTime: '23:00' },
  ): ItineraryItemDto[] {
    const window = getAwakeWindow(bounds.wakeTime, bounds.sleepTime);

    return items.map((item) => {
      const shiftMin = this.resolveShift(item, window);
      if (shiftMin === 0) return item;

      const adjusted = new Date(new Date(item.scheduledAt).getTime() + shiftMin * 60_000);
      return { ...item, scheduledAt: adjusted.toISOString() };
    });
  }

  describeConstraints(bounds: ScheduleBounds): string {
    return `기상: ${bounds.wakeTime}, 취침: ${bounds.sleepTime}. 이 범위 내에서만 일정 배치.`;
  }

  /**
   * 일정을 활동 구간 안으로 넣기 위해 옮길 분(양수=뒤로, 음수=앞으로). 0 이면 그대로 둔다.
   *
   * 활동 구간보다 긴 일정은 어디에 둬도 들어가지 않으므로 건드리지 않는다 — 이 경우
   * ConstraintEngine 이 위반으로 보고해 사용자가 판단하게 한다.
   */
  private resolveShift(item: ItineraryItemDto, window: AwakeWindow): number {
    const elapsed = minutesSinceWake(
      getKstMinutes(new Date(item.scheduledAt)),
      window.wakeMinutes,
    );
    const latestStart = window.lengthMinutes - item.durationMin;
    if (latestStart < 0) return 0;

    if (elapsed <= window.lengthMinutes) {
      // 활동 구간 안에서 시작한다. 취침을 넘겨 끝나면 끝이 취침에 맞도록 당긴다.
      return elapsed <= latestStart ? 0 : latestStart - elapsed;
    }

    // 수면 구간에서 시작한다. 다음 기상까지 미는 것과 취침 전으로 당기는 것 중 가까운 쪽으로
    // 옮긴다. 멀리 옮길수록 원래 의도한 시간대에서 벗어나고, 하루를 건너뛰면 다음 날
    // 일정과 겹치기 때문이다.
    const pushToWake = MINUTES_PER_DAY - elapsed;
    const pullBeforeSleep = elapsed - latestStart;
    return pushToWake <= pullBeforeSleep ? pushToWake : latestStart - elapsed;
  }
}
