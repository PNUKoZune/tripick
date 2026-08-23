import { Injectable, Logger } from '@nestjs/common';
import {
  addDaysToIsoDate,
  fitsInAwakeWindow,
  getAwakeWindow,
  getKstMinutes,
  toKstIsoDate,
} from '@tripick/utils';
import { RouteHelper } from '../helpers/route.helper';
import { ScheduleConstraint } from '../helpers/schedule.constraint';
import type { ItineraryItemDto, RouteMode } from '@tripick/types';

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  items: ItineraryItemDto[];
}

export interface ConstraintValidationOptions {
  wakeTime?: string;
  sleepTime?: string;
  transportMode?: RouteMode;
  /**
   * 여행 시작일(KST 'YYYY-MM-DD'). 주면 `day` 와 `scheduledAt` 의 실제 날짜가 어긋난 항목을
   * 위반으로 잡는다. 안 주면(수동 편집 등 시작일을 모르는 호출) 이 검사는 건너뛴다.
   */
  tripStartDate?: string;
}

/**
 * 한 구간(장소→장소) 이동시간의 하드 상한(분).
 *
 * 상한이 없어서 생기던 문제 — 지역을 이탈한 후보 하나가 하루를 통째로 삼켜도 "예약한 여유 ≥
 * 실제 ETA" 는 성립하므로 검증을 그대로 통과했다(실측: 경주 여행에 단양의 '경주식당'이 들어가
 * 이동 457분, 그 여파로 뒤 항목이 자정을 넘겼다).
 *
 * 180분인 이유 — 국내 하루 일정에서 한 구간에 3시간을 쓰는 동선은 어떤 목적지에서도 정상이
 * 아니다. 반대로 제주·강원처럼 넓은 목적지의 정상적인 구간(60~90분)까지 막으면 재생성이
 * 전부 실패해 여행 생성이 죽으므로, "명백히 깨진 것만" 잡는 높이로 둔다.
 */
const MAX_LEG_TRAVEL_MIN = 180;

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
    // trips.service 의 기본 이동 수단과 맞춘다.
    const mode = options.transportMode ?? 'transit';

    const bounded = this.scheduleConstraint.apply(items, {
      wakeTime,
      sleepTime,
    });

    for (const item of bounded) {
      // 시작일을 알면 **절대 구간**으로 본다(날짜 밀림까지 잡힌다). 모르면 시각만 본다.
      if (options.tripStartDate) {
        if (!this.checkDayWindow(item, options.tripStartDate, wakeTime, sleepTime)) {
          issues.push(
            `"${item.name}" ${item.day}일차 활동 구간 밖 일정 (${toKstIsoDate(new Date(item.scheduledAt))} ${this.kstTimeLabel(item.scheduledAt)})`,
          );
        }
      } else if (!this.checkScheduleBounds(item, wakeTime, sleepTime)) {
        issues.push(`"${item.name}" 기상/취침 시간 범위 밖 일정 (${item.scheduledAt})`);
      }
      if (!this.checkOpeningHours(item)) {
        issues.push(`"${item.name}" 영업시간 외 방문 시간 (${item.scheduledAt})`);
      }
    }

    const legs: Array<{ current: ItineraryItemDto; next: ItineraryItemDto }> = [];
    for (let index = 0; index < bounded.length - 1; index += 1) {
      const current = bounded[index]!;
      const next = bounded[index + 1]!;

      if (current.tripId !== next.tripId || current.day !== next.day) continue;
      legs.push({ current, next });
    }

    // 구간끼리 의존이 없으므로 병렬로 조회한다. 순차로 돌리면 캐시 미스 시 외부 API
    // 왕복이 구간 수만큼 직렬로 쌓여 createTrip 응답이 그만큼 늦어진다.
    const etas = await Promise.all(
      legs.map((leg) =>
        this.routeHelper.getEta(leg.current.coordinates, leg.next.coordinates, mode),
      ),
    );

    legs.forEach(({ current, next }, index) => {
      const etaMin = Math.ceil(etas[index]!.durationSec / 60);
      const currentEnd = new Date(current.scheduledAt).getTime() + current.durationMin * 60000;
      const nextStart = new Date(next.scheduledAt).getTime();
      const bufferMs = nextStart - currentEnd;

      if (bufferMs < etaMin * 60000) {
        issues.push(
          `"${current.name}" → "${next.name}" 이동 시간 부족 (필요: ${etaMin}분, 여유: ${Math.floor(bufferMs / 60000)}분)`,
        );
      }
      if (etaMin > MAX_LEG_TRAVEL_MIN) {
        issues.push(
          `"${current.name}" → "${next.name}" 이동 시간 과다 (${etaMin}분, 상한 ${MAX_LEG_TRAVEL_MIN}분)`,
        );
      }
    });

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
    const visitStart = getKstMinutes(new Date(item.scheduledAt));
    const visitEnd = visitStart + item.durationMin;
    return visitStart >= start && visitEnd <= end;
  }

  /**
   * 항목이 그 일차의 활동 구간(기상~취침)에 **절대 시각 기준**으로 들어가는지.
   *
   * 왜 시각 비교로는 부족한가 — `checkScheduleBounds` 는 HH:MM 만 보므로 날짜가 통째로 밀린
   * 항목을 그대로 통과시킨다(실측: day1 항목이 D+1 07:30 에 저장돼 day2 첫 항목과 겹쳤다).
   *
   * 왜 달력 날짜 비교로도 부족한가 — 취침이 01:00 인 여행은 자정을 넘긴 일정이 **정상**이다.
   * 날짜만 비교하면 그걸 전부 위반으로 잡아 재생성이 죽는다.
   *
   * 그래서 "그 일차 기상 시각부터 활동 구간 길이만큼" 이라는 하나의 절대 구간으로 판정한다.
   * `PlannerService.dayEndAt` 이 초안을 만들 때 쓰는 경계와 같은 정의다.
   */
  private checkDayWindow(
    item: ItineraryItemDto,
    tripStartDate: string,
    wakeTime: string,
    sleepTime: string,
  ): boolean {
    const window = getAwakeWindow(wakeTime, sleepTime);
    const dayStart = Date.parse(
      `${addDaysToIsoDate(tripStartDate, item.day - 1)}T${wakeTime}:00+09:00`,
    );
    if (!Number.isFinite(dayStart)) return true;
    const dayEnd = dayStart + window.lengthMinutes * 60_000;
    const startAt = new Date(item.scheduledAt).getTime();
    return startAt >= dayStart && startAt + item.durationMin * 60_000 <= dayEnd;
  }

  /** 위반 메시지용 KST 시각 라벨. */
  private kstTimeLabel(scheduledAt: string): string {
    const minutes = getKstMinutes(new Date(scheduledAt));
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  private checkScheduleBounds(item: ItineraryItemDto, wakeTime: string, sleepTime: string): boolean {
    const window = getAwakeWindow(wakeTime, sleepTime);
    return fitsInAwakeWindow(getKstMinutes(new Date(item.scheduledAt)), item.durationMin, window);
  }
}
