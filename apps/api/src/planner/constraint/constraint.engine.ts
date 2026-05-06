import { Injectable, Logger } from '@nestjs/common';
import { RouteHelper } from '../helpers/route.helper';
import { ScheduleConstraint } from '../helpers/schedule.constraint';
import type { ItineraryItemDto } from '@tripick/types';

interface ValidationResult {
  valid: boolean;
  issues: string[];
  items: ItineraryItemDto[];
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
    options: { wakeTime?: string; sleepTime?: string; transportMode?: string } = {},
  ): Promise<ValidationResult> {
    const issues: string[] = [];

    const bounded = this.scheduleConstraint.apply(items, {
      wakeTime: options.wakeTime ?? '07:00',
      sleepTime: options.sleepTime ?? '23:00',
    });

    for (const item of bounded) {
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

  private getKstMinutes(date: Date): number {
    return ((date.getUTCHours() * 60 + date.getUTCMinutes()) + KST_OFFSET_MINUTES) % (24 * 60);
  }
}
