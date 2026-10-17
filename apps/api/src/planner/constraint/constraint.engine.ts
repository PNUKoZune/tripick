import { Injectable, Logger } from '@nestjs/common';
import { fitsInAwakeWindow, getAwakeWindow, getKstMinutes, toKstIsoDate } from '@tripick/utils';
import { RouteHelper } from '../helpers/route.helper';
import { ScheduleConstraint } from '../helpers/schedule.constraint';
import type { ItineraryItemDto, RouteMode } from '@tripick/types';

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  /** Legacy alias of normalizedItems. The caller's input is never modified. */
  items: ItineraryItemDto[];
  normalizedItems: ItineraryItemDto[];
  normalizationChanges: ConstraintNormalizationChange[];
  violations: ConstraintViolation[];
  unknownConstraints: UnknownConstraint[];
  /** Sum of available route ETAs, including estimates. Null when validation is incomplete. */
  travelTimeMin: number | null;
}

export type ConstraintViolationCode =
  | 'ACTIVITY_WINDOW'
  | 'DAY_WINDOW'
  | 'OPENING_HOURS'
  | 'INSUFFICIENT_TRAVEL_TIME'
  | 'EXCESSIVE_TRAVEL_TIME'
  | 'INVALID_INPUT'
  | 'ROUTE_UNAVAILABLE';

export interface ConstraintViolation {
  code: ConstraintViolationCode;
  itemId?: string;
  relatedItemId?: string;
  message: string;
}

export interface UnknownConstraint {
  code: 'OPENING_HOURS_MISSING' | 'OPENING_HOURS_UNPARSEABLE' | 'ROUTE_UNAVAILABLE';
  itemId?: string;
  relatedItemId?: string;
  message: string;
}

export interface ConstraintNormalizationChange {
  itemId: string;
  field: 'scheduledAt';
  before: string;
  after: string;
  reason: string;
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
  /** Bounds waiting for each route; underlying shared RouteHelper requests may finish later. */
  routeTimeoutMs?: number;
  signal?: AbortSignal;
  /** Internal computation scope for shared ETA budgets; never accepted from HTTP input. */
  routeLookup?: RouteHelper['getEta'];
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
const DEFAULT_ROUTE_TIMEOUT_MS = 10_000;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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
    const violations: ConstraintViolation[] = [];
    const unknownConstraints: UnknownConstraint[] = [];
    const normalizationChanges: ConstraintNormalizationChange[] = [];
    const fail = (
      code: ConstraintViolationCode,
      message: string,
      itemId?: string,
      relatedItemId?: string,
    ) => {
      violations.push({
        code,
        ...(itemId === undefined ? {} : { itemId }),
        ...(relatedItemId === undefined ? {} : { relatedItemId }),
        message,
      });
    };
    const result = (
      normalizedItems: ItineraryItemDto[],
      travelTimeMin: number | null,
    ): ValidationResult => {
      const issues = violations.map((violation) => violation.message);
      if (issues.length > 0) this.logger.warn(`Constraint violations: ${issues.join('; ')}`);
      return {
        valid: violations.length === 0,
        issues,
        items: normalizedItems,
        normalizedItems,
        normalizationChanges,
        violations,
        unknownConstraints,
        travelTimeMin,
      };
    };
    if (!Array.isArray(items)) {
      fail('INVALID_INPUT', '일정은 배열이어야 합니다');
      return result([], null);
    }
    // Clone before calling ScheduleConstraint: unchanged items used to retain input references.
    const cloned = items.map((item) =>
      item && typeof item === 'object'
        ? { ...item, coordinates: item.coordinates && { ...item.coordinates } }
        : item,
    );
    const wakeTime = options.wakeTime ?? '07:00';
    const sleepTime = options.sleepTime ?? '23:00';
    // trips.service 의 기본 이동 수단과 맞춘다.
    const mode = options.transportMode ?? 'transit';
    if (!TIME_PATTERN.test(wakeTime) || !TIME_PATTERN.test(sleepTime)) {
      fail('INVALID_INPUT', '기상/취침 시간은 유효한 HH:mm 형식이어야 합니다');
    }
    if (options.tripStartDate !== undefined && !this.isIsoDate(options.tripStartDate)) {
      fail('INVALID_INPUT', '여행 시작일은 유효한 YYYY-MM-DD 형식이어야 합니다');
    }
    if (!['car', 'transit', 'walk'].includes(mode)) {
      fail('INVALID_INPUT', '지원하지 않는 이동 수단입니다');
    }
    if (
      options.routeTimeoutMs !== undefined &&
      (!Number.isFinite(options.routeTimeoutMs) ||
        options.routeTimeoutMs <= 0 ||
        options.routeTimeoutMs > 2_147_483_647)
    ) {
      fail('INVALID_INPUT', '경로 조회 제한 시간은 1~2147483647ms 범위여야 합니다');
    }
    const seenIds = new Set<string>();
    for (const [index, item] of cloned.entries()) {
      const errors = this.inputErrors(item, options.tripStartDate);
      if (item && typeof item.id === 'string') {
        if (seenIds.has(item.id)) errors.push('중복된 일정 ID');
        seenIds.add(item.id);
      }
      if (errors.length > 0) {
        fail('INVALID_INPUT', `${index + 1}번째 일정 입력 오류: ${errors.join(', ')}`, item?.id);
      }
    }
    // Never send malformed dates to Intl/ScheduleConstraint or malformed coordinates to routing.
    if (violations.length > 0) return result(cloned, null);

    const before = cloned.map((item) => item.scheduledAt);
    const bounded = this.scheduleConstraint.apply(cloned, {
      wakeTime,
      sleepTime,
    });
    bounded.forEach((item, index) => {
      if (before[index] !== item.scheduledAt) {
        normalizationChanges.push({
          itemId: item.id,
          field: 'scheduledAt',
          before: before[index]!,
          after: item.scheduledAt,
          reason: '기상/취침 활동 구간에 맞춰 방문 시각 조정',
        });
      }
    });

    for (const item of bounded) {
      // 시작일을 알면 **절대 구간**으로 본다(날짜 밀림까지 잡힌다). 모르면 시각만 본다.
      if (options.tripStartDate) {
        if (!this.checkDayWindow(item, options.tripStartDate, wakeTime, sleepTime)) {
          fail(
            'DAY_WINDOW',
            `"${item.name}" ${item.day}일차 활동 구간 밖 일정 (${toKstIsoDate(new Date(item.scheduledAt))} ${this.kstTimeLabel(item.scheduledAt)})`,
            item.id,
          );
        }
      } else if (!this.checkScheduleBounds(item, wakeTime, sleepTime)) {
        fail(
          'ACTIVITY_WINDOW',
          `"${item.name}" 기상/취침 시간 범위 밖 일정 (${item.scheduledAt})`,
          item.id,
        );
      }
      const openingHours = this.checkOpeningHours(item);
      if (openingHours === 'missing' || openingHours === 'unparseable') {
        unknownConstraints.push({
          code: openingHours === 'missing' ? 'OPENING_HOURS_MISSING' : 'OPENING_HOURS_UNPARSEABLE',
          itemId: item.id,
          message: `"${item.name}" 영업시간 ${openingHours === 'missing' ? '정보 없음' : '해석 불가'} — 방문 가능 여부 확인 필요`,
        });
      } else if (!openingHours) {
        fail(
          'OPENING_HOURS',
          `"${item.name}" 영업시간 외 방문 시간 (${item.scheduledAt})`,
          item.id,
        );
      }
    }

    const legs: Array<{ current: ItineraryItemDto; next: ItineraryItemDto }> = [];
    // Persisted order defines the route, even when a request lists days/items out of order.
    // Sort a copy so the legacy return value retains the caller's array order.
    const ordered = [...bounded].sort(
      (a, b) =>
        a.tripId.localeCompare(b.tripId) ||
        a.day - b.day ||
        a.order - b.order ||
        Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) ||
        a.id.localeCompare(b.id),
    );
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const current = ordered[index]!;
      const next = ordered[index + 1]!;

      if (current.tripId !== next.tripId || current.day !== next.day) continue;
      legs.push({ current, next });
    }

    // 구간끼리 의존이 없으므로 병렬로 조회한다. 순차로 돌리면 캐시 미스 시 외부 API
    // 왕복이 구간 수만큼 직렬로 쌓여 createTrip 응답이 그만큼 늦어진다.
    const etas = await Promise.allSettled(
      legs.map((leg) => this.routeEta(leg.current, leg.next, mode, options)),
    );

    let travelTimeMin: number | null = 0;
    legs.forEach(({ current, next }, index) => {
      const eta = etas[index]!;
      if (
        eta.status === 'rejected' ||
        !Number.isFinite(eta.value?.durationSec) ||
        eta.value.durationSec < 0
      ) {
        const message = `"${current.name}" → "${next.name}" 경로 조회 불가 — 이동 시간 검증 불가`;
        fail('ROUTE_UNAVAILABLE', message, current.id, next.id);
        unknownConstraints.push({
          code: 'ROUTE_UNAVAILABLE',
          itemId: current.id,
          relatedItemId: next.id,
          message,
        });
        travelTimeMin = null;
        return;
      }
      const etaMin = Math.ceil(eta.value.durationSec / 60);
      if (travelTimeMin !== null) travelTimeMin += etaMin;
      const currentEnd = new Date(current.scheduledAt).getTime() + current.durationMin * 60000;
      const nextStart = new Date(next.scheduledAt).getTime();
      const bufferMs = nextStart - currentEnd;

      if (bufferMs < etaMin * 60000) {
        fail(
          'INSUFFICIENT_TRAVEL_TIME',
          `"${current.name}" → "${next.name}" 이동 시간 부족 (필요: ${etaMin}분, 여유: ${Math.floor(bufferMs / 60000)}분)`,
          current.id,
          next.id,
        );
      }
      if (etaMin > MAX_LEG_TRAVEL_MIN) {
        fail(
          'EXCESSIVE_TRAVEL_TIME',
          `"${current.name}" → "${next.name}" 이동 시간 과다 (${etaMin}분, 상한 ${MAX_LEG_TRAVEL_MIN}분)`,
          current.id,
          next.id,
        );
      }
    });

    return result(bounded, travelTimeMin);
  }

  private checkOpeningHours(item: ItineraryItemDto): boolean | 'missing' | 'unparseable' {
    if (item.openingHours === undefined || item.openingHours === null || item.openingHours === '')
      return 'missing';
    if (typeof item.openingHours !== 'string') return 'unparseable';
    const match = item.openingHours.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!match) return 'unparseable';

    const [, startHour, startMinute, endHour, endMinute] = match;
    if (
      !TIME_PATTERN.test(`${startHour}:${startMinute}`) ||
      (!TIME_PATTERN.test(`${endHour}:${endMinute}`) && `${endHour}:${endMinute}` !== '24:00')
    )
      return 'unparseable';
    const start = Number(startHour) * 60 + Number(startMinute);
    let end = Number(endHour) * 60 + Number(endMinute);
    if (end === start) return 'unparseable';
    let visitStart = getKstMinutes(new Date(item.scheduledAt));
    if (end < start) {
      end += 24 * 60;
      if (visitStart < start) visitStart += 24 * 60;
    }
    const visitEnd = visitStart + item.durationMin;
    return visitStart >= start && visitEnd <= end;
  }

  private isIsoDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  private inputErrors(item: ItineraryItemDto, tripStartDate?: string): string[] {
    if (!item || typeof item !== 'object') return ['일정 객체가 필요합니다'];
    const errors: string[] = [];
    if (typeof item.id !== 'string' || !item.id.trim()) errors.push('유효한 일정 ID 필요');
    if (typeof item.tripId !== 'string' || !item.tripId.trim()) errors.push('유효한 여행 ID 필요');
    if (!Number.isSafeInteger(item.day) || item.day < 1) errors.push('일차는 1 이상의 정수');
    if (!Number.isSafeInteger(item.order) || item.order < 0) errors.push('순서는 0 이상의 정수');
    if (!Number.isFinite(item.durationMin) || item.durationMin <= 0)
      errors.push('체류 시간은 양수');
    const timestamp =
      typeof item.scheduledAt === 'string'
        ? item.scheduledAt.match(
            /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
          )
        : null;
    const scheduledAt = timestamp ? Date.parse(item.scheduledAt) : NaN;
    if (
      !timestamp ||
      !this.isIsoDate(timestamp[1]) ||
      !Number.isFinite(scheduledAt) ||
      !Number.isFinite(new Date(scheduledAt + item.durationMin * 60_000).getTime())
    ) {
      errors.push('유효한 방문 시각 필요');
    }
    if (
      !item.coordinates ||
      !Number.isFinite(item.coordinates.lat) ||
      !Number.isFinite(item.coordinates.lng) ||
      Math.abs(item.coordinates.lat) > 90 ||
      Math.abs(item.coordinates.lng) > 180
    )
      errors.push('유효한 위도/경도 필요');
    if (
      tripStartDate &&
      !Number.isFinite(
        new Date(Date.parse(`${tripStartDate}T00:00:00Z`) + (item.day - 1) * 86_400_000).getTime(),
      )
    ) {
      errors.push('여행 일차가 날짜 범위를 벗어남');
    }
    return errors;
  }

  private routeEta(
    current: ItineraryItemDto,
    next: ItineraryItemDto,
    mode: RouteMode,
    options: ConstraintValidationOptions,
  ): Promise<{ durationSec: number; distanceM: number }> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error('Route validation aborted'));
        return;
      }
      const abort = () => finish(new Error('Route validation aborted'));
      const timer = setTimeout(
        () => finish(new Error('Route validation timed out')),
        options.routeTimeoutMs ?? DEFAULT_ROUTE_TIMEOUT_MS,
      );
      const finish = (error: Error | null, eta?: { durationSec: number; distanceM: number }) => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(eta!);
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      // Promise.resolve also turns synchronous helper failures into one rejected leg.
      Promise.resolve()
        .then(() =>
          options.routeLookup
            ? options.routeLookup(current.coordinates, next.coordinates, mode)
            : this.routeHelper.getEta(current.coordinates, next.coordinates, mode),
        )
        .then(
          (eta) => finish(null, eta),
          (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))),
        );
    });
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
    // KST has no DST; integer day offsets avoid reparsing overflowing calendar years.
    const dayStart =
      Date.parse(`${tripStartDate}T${wakeTime}:00+09:00`) + (item.day - 1) * 86_400_000;
    if (!Number.isFinite(dayStart)) return false;
    const dayEnd = dayStart + window.lengthMinutes * 60_000;
    const startAt = new Date(item.scheduledAt).getTime();
    return startAt >= dayStart && startAt + item.durationMin * 60_000 <= dayEnd;
  }

  /** 위반 메시지용 KST 시각 라벨. */
  private kstTimeLabel(scheduledAt: string): string {
    const minutes = getKstMinutes(new Date(scheduledAt));
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  private checkScheduleBounds(
    item: ItineraryItemDto,
    wakeTime: string,
    sleepTime: string,
  ): boolean {
    const window = getAwakeWindow(wakeTime, sleepTime);
    return fitsInAwakeWindow(getKstMinutes(new Date(item.scheduledAt)), item.durationMin, window);
  }
}
