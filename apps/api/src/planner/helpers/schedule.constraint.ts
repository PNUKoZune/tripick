import { Injectable } from '@nestjs/common';
import { timeToMinutes } from '@tripick/utils';
import type { ItineraryItemDto } from '@tripick/types';

interface ScheduleBounds {
  wakeTime: string;
  sleepTime: string;
}

const KST_OFFSET_MINUTES = 9 * 60;

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
      const itemMin = this.getKstMinutes(itemDate);

      if (itemMin < wakeMin) {
        const adjusted = this.setKstTime(itemDate, wakeMin);
        return { ...item, scheduledAt: adjusted.toISOString() };
      }

      if (itemMin + item.durationMin > sleepMin) {
        const adjustedMin = sleepMin - item.durationMin;
        if (adjustedMin >= wakeMin) {
          const adjusted = this.setKstTime(itemDate, adjustedMin);
          return { ...item, scheduledAt: adjusted.toISOString() };
        }
      }

      return item;
    });
  }

  describeConstraints(bounds: ScheduleBounds): string {
    return `기상: ${bounds.wakeTime}, 취침: ${bounds.sleepTime}. 이 범위 내에서만 일정 배치.`;
  }

  private getKstMinutes(date: Date): number {
    return ((date.getUTCHours() * 60 + date.getUTCMinutes()) + KST_OFFSET_MINUTES) % (24 * 60);
  }

  private setKstTime(source: Date, minutes: number): Date {
    const adjusted = new Date(source);
    const utcMinutes = minutes - KST_OFFSET_MINUTES;
    const hours = Math.floor(((utcMinutes % (24 * 60)) + (24 * 60)) % (24 * 60) / 60);
    const mins = ((utcMinutes % 60) + 60) % 60;
    adjusted.setUTCHours(hours, mins, 0, 0);
    return adjusted;
  }
}
