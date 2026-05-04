import { Injectable } from '@nestjs/common';
import { timeToMinutes, minutesToTime } from '@tripick/utils';
import type { ItineraryItemDto } from '@tripick/types';

interface ScheduleBounds {
  /** 기상 시간 (기본: "07:00") */
  wakeTime: string;
  /** 취침 시간 (기본: "23:00") */
  sleepTime: string;
}

/**
 * 취침·기상 시간 제약 적용 Helper
 *
 * 일정 아이템 시작 시간이 취침~기상 범위를 벗어나면 조정.
 */
@Injectable()
export class ScheduleConstraint {
  apply(
    items: ItineraryItemDto[],
    bounds: ScheduleBounds = { wakeTime: '07:00', sleepTime: '23:00' },
  ): ItineraryItemDto[] {
    const wakeMin = timeToMinutes(bounds.wakeTime);
    const sleepMin = timeToMinutes(bounds.sleepTime);

    return items.map((item) => {
      const itemDate = new Date(item.scheduledAt);
      const itemMin = itemDate.getHours() * 60 + itemDate.getMinutes();

      if (itemMin < wakeMin) {
        itemDate.setHours(Math.floor(wakeMin / 60), wakeMin % 60, 0, 0);
        return { ...item, scheduledAt: itemDate.toISOString() };
      }

      if (itemMin + item.durationMin > sleepMin) {
        // 취침 시간을 넘기는 경우 → 전날 마지막 가능 시간으로 당김
        const adjustedMin = sleepMin - item.durationMin;
        if (adjustedMin >= wakeMin) {
          itemDate.setHours(Math.floor(adjustedMin / 60), adjustedMin % 60, 0, 0);
          return { ...item, scheduledAt: itemDate.toISOString() };
        }
      }

      return item;
    });
  }

  describeConstraints(bounds: ScheduleBounds): string {
    return `기상: ${bounds.wakeTime}, 취침: ${bounds.sleepTime}. 이 범위 내에서만 일정 배치.`;
  }
}
