import { Injectable, Logger } from '@nestjs/common';
import { RouteHelper } from '../helpers/route.helper';
import { ScheduleConstraint } from '../helpers/schedule.constraint';
import type { ItineraryItemDto } from '@tripick/types';

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  items: ItineraryItemDto[];
}

export interface ConstraintValidationOptions {
  wakeTime?: string;
  sleepTime?: string;
  transportMode?: string;
}

const KST_OFFSET_MINUTES = 9 * 60;

@Injectable()
export class ConstraintEngine {
  private readonly logger = new Logger(ConstraintEngine.name);

  constructor(
    private readonly routeHelper: RouteHelper,
    private readonly scheduleConstraint: ScheduleConstraint,
  ) {}

  async validate(
    items: ItineraryItemDto[],
    options: ConstraintValidationOptions = {},
  ): Promise<ValidationResult> {
    const issues: string[] = [];
    const wakeTime = options.wakeTime ?? '07:00';
    const sleepTime = options.sleepTime ?? '23:00';

    const bounded = this.scheduleConstraint.apply(items, {
      wakeTime,
      sleepTime,
    });

    for (const item of bounded) {
      if (!this.checkScheduleBounds(item, wakeTime, sleepTime)) {
        issues.push(`"${item.name}" 기상/취침 시간 범위 밖 일정 (${item.scheduledAt})`);
      }
      if (!this.checkOpeningHours(item)) {
        issues.push(`"${item.name}" 영업시간 외 방문 시간 (${item.scheduledAt})`);
      }
    }

    for (let index = 0; index < bounded.length - 1; index += 1) {
      const current = bounded[index]!;
      const next = bounded[index + 1]!;

      if (current.tripId !== next.tripId || current.day !== next.day) continue;

      const eta = options.transportMode === 'car'
        ? await this.routeHelper.getDrivingEta(current.coordinates, next.coordinates)
        : await this.routeHelper.getTransitEta(current.coordinates, next.coordinates);

      const etaMin = Math.ceil(eta.durationSec / 60);
      const currentEnd = new Date(current.scheduledAt).getTime() + current.durationMin * 60000;
      const nextStart = new Date(next.scheduledAt).getTime();
      const bufferMs = nextStart - currentEnd;

      if (bufferMs < etaMin * 60000) {
        issues.push(
          `"${current.name}" → "${next.name}" 이동 시간 부족 (필요: ${etaMin}분, 여유: ${Math.floor(bufferMs / 60000)}분)`,
        );
      }
    }

    if (issues.length > 0) {
      this.logger.warn(`Constraint violations: ${issues.join('; ')}`);
    }

    return { valid: issues.length === 0, issues, items: bounded };
  }

  private checkOpeningHours(item: ItineraryItemDto): boolean {
    if (!item.openingHours) return true;
    const match = item.openingHours.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!match) return true;

    const [, startHour, startMinute, endHour, endMinute] = match;
    const start = Number(startHour) * 60 + Number(startMinute);
    const end = Number(endHour) * 60 + Number(endMinute);
    const visitStart = this.getKstMinutes(new Date(item.scheduledAt));
    const visitEnd = visitStart + item.durationMin;
    return visitStart >= start && visitEnd <= end;
  }

  private checkScheduleBounds(item: ItineraryItemDto, wakeTime: string, sleepTime: string): boolean {
    const wake = this.timeToMinutes(wakeTime);
    const sleep = this.timeToMinutes(sleepTime);
    const visitStart = this.getKstMinutes(new Date(item.scheduledAt));
    const visitEnd = visitStart + item.durationMin;
    return visitStart >= wake && visitEnd <= sleep;
  }

  private timeToMinutes(value: string): number {
    const [hour, minute] = value.split(':').map(Number);
    return (hour ?? 0) * 60 + (minute ?? 0);
  }

  private getKstMinutes(date: Date): number {
    return ((date.getUTCHours() * 60 + date.getUTCMinutes()) + KST_OFFSET_MINUTES) % (24 * 60);
  }
}
