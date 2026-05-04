import { Injectable, Logger } from '@nestjs/common';
import { RouteHelper } from '../helpers/route.helper';
import { ScheduleConstraint } from '../helpers/schedule.constraint';
import type { ItineraryItemDto } from '@tripick/types';

interface ValidationResult {
  valid: boolean;
  issues: string[];
  items: ItineraryItemDto[];
}

/**
 * Constraint Engine
 *
 * 검증 항목:
 * 1. 영업시간 (Opening Hours)
 * 2. 이동시간 (Travel Time) — TMAP / ODsay ETA 기반
 * 3. 경로 실현 가능성 (Route Feasibility)
 * 4. 취침·기상 시간 제약 (ScheduleConstraint)
 */
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

    // 1. 취침·기상 제약 적용
    const bounded = this.scheduleConstraint.apply(items, {
      wakeTime: options.wakeTime ?? '07:00',
      sleepTime: options.sleepTime ?? '23:00',
    });

    // 2. 영업시간 검증
    for (const item of bounded) {
      if (!this.checkOpeningHours(item)) {
        issues.push(`"${item.name}" 영업시간 외 방문 시간 (${item.scheduledAt})`);
      }
    }

    // 3. 이동시간 검증 (연속된 장소 간 ETA)
    for (let i = 0; i < bounded.length - 1; i++) {
      const curr = bounded[i]!;
      const next = bounded[i + 1]!;

      if (curr.tripId !== next.tripId || curr.day !== next.day) continue;

      const eta = options.transportMode === 'car'
        ? await this.routeHelper.getDrivingEta(curr.coordinates, next.coordinates)
        : await this.routeHelper.getTransitEta(curr.coordinates, next.coordinates);

      const etaMin = Math.ceil(eta.durationSec / 60);
      const currEnd = new Date(curr.scheduledAt).getTime() + curr.durationMin * 60000;
      const nextStart = new Date(next.scheduledAt).getTime();
      const bufferMs = nextStart - currEnd;

      if (bufferMs < etaMin * 60000) {
        issues.push(
          `"${curr.name}" → "${next.name}" 이동 시간 부족 (필요: ${etaMin}분, 여유: ${Math.floor(bufferMs / 60000)}분)`,
        );
      }
    }

    if (issues.length > 0) {
      this.logger.warn(`Constraint violations: ${issues.join('; ')}`);
    }

    return { valid: issues.length === 0, issues, items: bounded };
  }

  private checkOpeningHours(item: ItineraryItemDto): boolean {
    if (!item.openingHours) return true; // 정보 없으면 통과

    // TODO: 영업시간 파싱 로직 구현 (한국관광공사 API 형식 파싱)
    return true;
  }
}
