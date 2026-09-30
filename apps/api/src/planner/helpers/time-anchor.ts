import { timeToMinutes } from '@tripick/utils';
import type { PlannedCandidate } from '../agent/planner-agent.service';
import type { CandidatePlace } from '../retrieval/types';
import {
  ESTIMATED_TRAVEL_MINUTES,
  MIN_VISIT_MINUTES,
  defaultVisitDuration,
  itemsFittingGap,
  itemsFittingRemaining,
} from './itinerary-density';

/**
 * 재계획 요청 문장에서 뽑은 "그 시각에 그걸 하고 싶다" 한 건.
 *
 * 왜 따로 뽑나 — 요청 문장은 LLM 프롬프트의 `notes` 로만 들어가는데, LLM 은 방문 순서(order)만
 * 정하고 시각은 `buildDraft` 가 체류+이동을 누적해 계산한다. 그래서 "12시에 카페" 는 LLM 이
 * 순서를 잘 맞춰도 우연히만 12시에 걸리고, LLM 을 안 거치는 결정적 경로(폴백·제약 재생성·
 * 일자별 지역)는 문장을 아예 못 읽는다. 구조화된 값으로 뽑아야 모든 경로가 같은 고정을 쓴다.
 */
export interface TimeAnchorRequest {
  /** 자정 기준 분(KST 벽시계) */
  minutes: number;
  /** 문장에 드러난 종류. 장소명이 매칭되면 그쪽이 우선이다. */
  category?: TimeAnchorCategory;
  /** "2일차" 처럼 일차를 짚었으면 그 값(1-based) */
  day?: number;
  /** 이 시각 언급을 둘러싼 문장 조각. 후보 장소명 매칭에 쓴다. */
  text: string;
}

/** `sightseeing` 은 식음(음식점·카페)이 아닌 모든 볼거리다. */
export type TimeAnchorCategory = 'cafe' | 'restaurant' | 'sightseeing';

/** 후보까지 풀어 낸 고정 한 건. */
export interface TimeAnchor {
  day: number;
  /** "HH:MM" (KST) */
  time: string;
  /** 장소명이 매칭됐으면 그 후보 id */
  candidateId?: string;
  category?: TimeAnchorCategory;
}

const KOREAN_HOURS: Record<string, number> = {
  한: 1,
  두: 2,
  세: 3,
  네: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
  열한: 11,
  열두: 12,
};

const MERIDIEM = '오전|오후|아침|새벽|낮|점심|저녁|밤';
const HOUR_WORD = '열두|열한|다섯|여섯|일곱|여덟|아홉|한|두|세|네|열';

/**
 * 시각 표현. `시(?!간)` — "2시간 동안" 은 체류 길이지 시각이 아니다.
 * 한글 수사는 긴 것부터 둔다("열두"가 "열"보다 먼저 걸려야 한다).
 */
const TIME_PATTERN = new RegExp(
  `(?:(${MERIDIEM})\\s*)?` +
    `(?:(\\d{1,2})\\s*:\\s*(\\d{2})|(\\d{1,2}|${HOUR_WORD})\\s*시(?!간)(?:\\s*(반|(\\d{1,2})\\s*분))?)`,
  'g',
);

/** 조각 경계. 쉼표·마침표·줄바꿈·"그리고" 로 나뉜 문장은 서로의 종류·일차를 빌려오지 않는다. */
const CLAUSE_SPLIT = /[,，.。!?！？;\n·]|그리고/;

const CAFE_WORDS = /카페|커피|디저트|베이커리|빵집/;
const RESTAURANT_WORDS = /식당|맛집|밥|식사|레스토랑|음식점|점심|먹/;
const SIGHTSEEING_WORDS = /관광지|명소|구경|볼거리|전시|박물관|미술관/;
/** "12시 카페는 빼줘" 는 고정이 아니라 제외 요청이다. */
const NEGATION_WORDS = /빼|제외|말고|없이|취소/;
const DAY_PATTERN = /(\d{1,2})\s*(?:일\s*차|일째|번째\s*날)/;
/**
 * 두 시각 사이에서 앞 요청이 끝나는 연결어미("들르고 ", "먹은 다음 "). 여기서 문맥을 자르지 않으면
 * "12시에 카페 들르고 7시에 식당" 의 두 번째 시각이 앞의 "카페" 를 물려받는다.
 */
const CONNECTIVE = /(?:고|며|서|다음에?|후에?|뒤에?)\s+/g;

/**
 * 오전/오후 표기가 없을 때의 해석. 여행 활동 시간대라 "3시" 는 새벽이 아니라 오후다.
 * 8~12 는 그대로, 1~7 은 오후로 본다.
 */
function resolveHour(hour: number, meridiem: string | undefined): number | null {
  if (hour < 0 || hour > 24) return null;
  switch (meridiem) {
    case '오후':
    case '저녁':
    case '밤':
      return hour < 12 ? hour + 12 : hour;
    case '낮':
    case '점심':
      return hour <= 5 ? hour + 12 : hour;
    case '오전':
    case '아침':
    case '새벽':
      return hour === 12 ? 0 : hour;
    default:
      return hour >= 1 && hour <= 7 ? hour + 12 : hour;
  }
}

function detectCategory(text: string): TimeAnchorCategory | undefined {
  // 카페가 먼저다 — "저녁 7시에 카페" 의 "저녁", "커피 먹으러" 의 "먹" 이 식사로 새지 않게.
  if (CAFE_WORDS.test(text)) return 'cafe';
  if (RESTAURANT_WORDS.test(text)) return 'restaurant';
  if (SIGHTSEEING_WORDS.test(text)) return 'sightseeing';
  return undefined;
}

/**
 * 자유 텍스트 요청에서 시각 고정 요청을 뽑는다.
 *
 * 규칙 기반인 이유 — LLM 으로 파싱하면 LLM 이 죽는 순간(타임아웃·미기동) 시각 고정도 같이
 * 사라진다. 결정적 폴백이 쓸 값이니 뽑는 것도 결정적이어야 한다.
 *
 * 한 조각에 시각이 여럿이면("12시 카페 들르고 7시에 식당") 두 시각 사이의 연결어미에서 문맥을
 * 가른다 — 그래야 앞 시각의 종류를 뒤 시각이 물려받지 않는다.
 */
export function parseTimeAnchors(note: string | null | undefined): TimeAnchorRequest[] {
  if (!note?.trim()) return [];
  const requests: TimeAnchorRequest[] = [];

  for (const clause of note.split(CLAUSE_SPLIT)) {
    const matches = [...clause.matchAll(TIME_PATTERN)];
    if (matches.length === 0) continue;
    const dayMatch = clause.match(DAY_PATTERN);
    const day = dayMatch ? Number(dayMatch[1]) : undefined;

    matches.forEach((match, index) => {
      const [, meridiem, colonHour, colonMinute, hourText, minutePart, minuteText] = match;
      const rawHour = colonHour ?? hourText!;
      const hourValue = /^\d+$/.test(rawHour) ? Number(rawHour) : KOREAN_HOURS[rawHour];
      if (hourValue === undefined) return;
      const hour = resolveHour(hourValue, meridiem);
      const minute = colonMinute
        ? Number(colonMinute)
        : minutePart === '반'
          ? 30
          : minuteText
            ? Number(minuteText)
            : 0;
      if (hour === null || hour >= 24 || minute >= 60) return;

      const from = index === 0 ? 0 : boundaryBetween(clause, matches[index - 1]!, match);
      const to =
        index === matches.length - 1
          ? clause.length
          : boundaryBetween(clause, match, matches[index + 1]!);
      const text = clause.slice(from, to);
      if (NEGATION_WORDS.test(text)) return;
      // 시각 표현 안의 "점심" 도 식사 신호다("점심 12시에 해운대" 는 장소명이 이긴다).
      const category = detectCategory(text);

      requests.push({
        minutes: hour * 60 + minute,
        ...(category ? { category } : {}),
        ...(day !== undefined ? { day } : {}),
        text,
      });
    });
  }
  return requests;
}

/**
 * 앞 시각과 뒤 시각 사이에서 문맥을 가르는 위치. 사이에 연결어미가 있으면 마지막 연결어미 뒤,
 * 없으면 뒤 시각의 시작(= 사이 문장은 앞 요청 몫)이다.
 */
function boundaryBetween(clause: string, before: RegExpMatchArray, after: RegExpMatchArray): number {
  const from = before.index! + before[0].length;
  const to = after.index!;
  let boundary = to;
  for (const connective of clause.slice(from, to).matchAll(CONNECTIVE)) {
    boundary = from + connective.index! + connective[0].length;
  }
  return boundary;
}

/** 공백을 지워 비교한다 — "해운대 해수욕장" 과 "해운대해수욕장" 을 같게 본다. */
function compact(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

/**
 * 문장 조각에 이름이 나오는 후보 중 가장 긴 이름. 짧은 이름이 긴 이름의 일부로 잘못 걸리는 걸
 * ("해운대" vs "해운대 블루라인파크") 길이 우선으로 막는다.
 */
export function matchCandidateByName(
  text: string,
  candidates: readonly CandidatePlace[],
): CandidatePlace | undefined {
  const haystack = compact(text);
  let best: CandidatePlace | undefined;
  for (const candidate of candidates) {
    const name = compact(candidate.name);
    if (name.length < 2 || !haystack.includes(name)) continue;
    if (!best || name.length > compact(best.name).length) best = candidate;
  }
  return best;
}

export function matchesAnchorCategory(
  candidate: CandidatePlace,
  category: TimeAnchorCategory,
): boolean {
  if (category === 'sightseeing') {
    return candidate.category !== 'restaurant' && candidate.category !== 'cafe';
  }
  return candidate.category === category;
}

/** 사용자 필수 포함 장소는 자리를 비울 때도 빼지 않는다(`buildMustIncludeCandidates` 의 id 규칙). */
function isMustInclude(planned: PlannedCandidate): boolean {
  return planned.candidate.id.startsWith('must-');
}

export interface ApplyTimeAnchorsParams {
  plan: PlannedCandidate[];
  anchors: readonly TimeAnchor[];
  /** 종류 고정을 새 후보로 채울 때 찾는 그 일차 풀(앞쪽 우선) */
  poolForDay: (day: number) => readonly CandidatePlace[];
  /** 장소명 고정의 후보 조회용 전체 후보 */
  allCandidates: readonly CandidatePlace[];
  dayStartTime: (day: number) => string;
  dayItemTarget: (day: number) => number;
}

/**
 * 고정 시각을 배치안에 심는다 — 대상 항목에 `pinnedAt` 을 달고, 그 일차 순서를 고정 시각에
 * 맞게 다시 편다. 실제 시각은 `buildDraft` 가 `pinnedAt` 을 보고 맞춘다.
 *
 * 대상 고르기: 장소명이 매칭되면 그 장소, 종류만 있으면 그 일차에 이미 있는 같은 종류 항목 중
 * 명목 시각이 가장 가까운 것을 옮긴다(카페를 하나 더 넣는 게 아니라 있던 카페를 12시로 당긴다).
 * 없을 때만 풀에서 새로 가져오고, 하루 개수 상한을 넘으면 고정·필수가 아닌 항목을 하나 뺀다.
 */
export function applyTimeAnchors(params: ApplyTimeAnchorsParams): {
  plan: PlannedCandidate[];
  unresolved: TimeAnchor[];
} {
  const { anchors, poolForDay, allCandidates, dayStartTime, dayItemTarget } = params;
  if (anchors.length === 0) return { plan: params.plan, unresolved: [] };

  const plan = params.plan.map((planned) => ({ ...planned }));
  const used = new Set(plan.map((planned) => planned.candidate.id));
  const unresolved: TimeAnchor[] = [];
  const touchedDays = new Set<number>();

  const sortedAnchors = [...anchors].sort(
    (a, b) => a.day - b.day || timeToMinutes(a.time) - timeToMinutes(b.time),
  );
  for (const anchor of sortedAnchors) {
    let target: PlannedCandidate | undefined;
    if (anchor.candidateId) {
      target = plan.find((planned) => planned.candidate.id === anchor.candidateId);
      if (target?.pinnedAt) target = undefined;
      else if (target) {
        touchedDays.add(target.day);
        target.day = anchor.day;
      } else {
        const candidate = allCandidates.find((place) => place.id === anchor.candidateId);
        if (candidate) target = pushNew(plan, used, candidate, anchor.day);
      }
    } else if (anchor.category) {
      const category = anchor.category;
      target = closestByNominalTime(
        plan.filter(
          (planned) =>
            planned.day === anchor.day &&
            !planned.pinnedAt &&
            matchesAnchorCategory(planned.candidate, category),
        ),
        plan,
        anchor,
        dayStartTime(anchor.day),
      );
      if (!target) {
        const candidate = poolForDay(anchor.day).find(
          (place) => !used.has(place.id) && matchesAnchorCategory(place, category),
        );
        if (candidate) target = pushNew(plan, used, candidate, anchor.day);
      }
    }

    if (!target) {
      unresolved.push(anchor);
      continue;
    }
    target.pinnedAt = anchor.time;
    touchedDays.add(anchor.day);
  }

  let result = plan;
  for (const day of touchedDays) {
    result = resequenceDay(result, day, dayStartTime(day), dayItemTarget(day));
  }
  return { plan: result, unresolved };
}

/**
 * 시각이 고정된 일차에 현실적으로 담기는 항목 수. 시각은 전부 같은 연속 척도(분)여야 한다.
 *
 * 남은 시간 전체로 개수를 정하면(`itemsFittingRemaining`) 고정 항목이 그 자리를 먼저 차지해,
 * 고정 시각 앞의 빈 시간이 통째로 빈다(실측: 16:01 재계획, 18:00 카페·19:30 식당 고정 → 상한 2개가
 * 둘 다 고정 항목 → 16:00~18:00 공백). 그래서 고정 시각 사이의 틈마다 따로 센다.
 */
export function pinnedDayCapacity(params: {
  startMin: number;
  endMin: number;
  pins: ReadonlyArray<{ atMin: number; durationMin: number }>;
}): number {
  let cursor = params.startMin;
  let count = 0;
  for (const pin of [...params.pins].sort((a, b) => a.atMin - b.atMin)) {
    count += itemsFittingGap(pin.atMin - cursor) + 1;
    cursor = Math.max(cursor, pin.atMin) + pin.durationMin;
  }
  // 마지막 고정 뒤는 끝이 열린 구간이다. 첫 이동을 빼고 남은 시간으로 센다.
  const tailMin = params.endMin - cursor - ESTIMATED_TRAVEL_MINUTES;
  return count + (tailMin >= MIN_VISIT_MINUTES ? itemsFittingRemaining(tailMin) : 0);
}

function pushNew(
  plan: PlannedCandidate[],
  used: Set<string>,
  candidate: CandidatePlace,
  day: number,
): PlannedCandidate {
  const entry: PlannedCandidate = {
    candidate,
    day,
    order: Number.MAX_SAFE_INTEGER,
    durationMin: defaultVisitDuration(candidate.category),
    memo: '사용자가 시각을 지정한 방문',
    aiGenerated: false,
  };
  plan.push(entry);
  used.add(candidate.id);
  return entry;
}

/** 그 일차 항목들을 순서대로 이었을 때의 명목 시작 시각(분). 체류 + 추정 이동 누적. */
function nominalStarts(dayItems: PlannedCandidate[], startTime: string): Map<PlannedCandidate, number> {
  const starts = new Map<PlannedCandidate, number>();
  let at = timeToMinutes(startTime);
  for (const planned of dayItems) {
    starts.set(planned, at);
    at += planned.durationMin + ESTIMATED_TRAVEL_MINUTES;
  }
  return starts;
}

function closestByNominalTime(
  options: PlannedCandidate[],
  plan: PlannedCandidate[],
  anchor: TimeAnchor,
  startTime: string,
): PlannedCandidate | undefined {
  if (options.length === 0) return undefined;
  const dayItems = plan
    .filter((planned) => planned.day === anchor.day)
    .sort((a, b) => a.order - b.order);
  const starts = nominalStarts(dayItems, startTime);
  const pin = timeToMinutes(anchor.time);
  return [...options].sort(
    (a, b) => Math.abs(starts.get(a)! - pin) - Math.abs(starts.get(b)! - pin),
  )[0];
}

/**
 * 한 일차를 고정 시각에 맞춰 다시 줄 세운다.
 *
 * 고정 항목 앞에는 **그 시각 전에 끝나고 이동까지 마칠 수 있는** 자유 항목만 둔다(체류를 최소치까지
 * 줄여서라도 넣는다). 자유 항목의
 * 상대 순서는 유지한다(LLM·슬롯 규칙이 정한 식사 리듬을 흩지 않으려고). 하루 상한을 넘으면
 * 고정·필수가 아닌 항목부터 뒤에서 뺀다 — `buildDraft` 의 `slice` 가 고정 항목을 잘라내지
 * 않게 여기서 먼저 맞춘다.
 */
function resequenceDay(
  plan: PlannedCandidate[],
  day: number,
  startTime: string,
  itemTarget: number,
): PlannedCandidate[] {
  const others = plan.filter((planned) => planned.day !== day);
  const dayItems = plan
    .filter((planned) => planned.day === day)
    .sort((a, b) => a.order - b.order);

  const pinned = dayItems
    .filter((planned) => planned.pinnedAt)
    .sort((a, b) => timeToMinutes(a.pinnedAt!) - timeToMinutes(b.pinnedAt!));
  const free = dayItems.filter((planned) => !planned.pinnedAt);
  // 넘친 만큼 뺀다. 고정 항목이 새로 들어오며 같은 종류(두 번째 카페)가 생겼으면 그걸 먼저 뺀다.
  while (pinned.length + free.length > Math.max(itemTarget, pinned.length)) {
    const removable = free
      .map((planned, index) => ({ planned, index }))
      .filter(({ planned }) => !isMustInclude(planned));
    if (removable.length === 0) break;
    // 뒤에서부터 본다 — 하루 끝 항목이 빠지는 쪽이 동선을 덜 흔든다.
    const fromEnd = [...removable].reverse();
    const duplicate = fromEnd.find(({ planned }) =>
      pinned.some((pin) => pin.candidate.category === planned.candidate.category),
    );
    const drop = duplicate ?? fromEnd[0]!;
    free.splice(drop.index, 1);
  }

  const sequenced: PlannedCandidate[] = [];
  let cursor = timeToMinutes(startTime);
  for (const pin of pinned) {
    const pinAt = timeToMinutes(pin.pinnedAt!);
    while (free.length > 0) {
      // 고정 시각 전까지 남은 체류 여유 — 고정 장소로 가는 이동을 먼저 떼어 둔다.
      const roomMin = pinAt - cursor - ESTIMATED_TRAVEL_MINUTES;
      if (roomMin < MIN_VISIT_MINUTES) break;
      // 원래 체류가 안 들어가면 줄여서라도 넣는다. 안 그러면 두 시간짜리 틈이 120분 관광지
      // 하나를 못 받아 통째로 빈다. 실제 체류는 buildDraft 가 실 이동시간으로 다시 맞춘다.
      const taken = free.shift()!;
      const next = { ...taken, durationMin: Math.min(taken.durationMin, roomMin) };
      sequenced.push(next);
      cursor += next.durationMin + ESTIMATED_TRAVEL_MINUTES;
    }
    sequenced.push(pin);
    cursor = Math.max(cursor, pinAt) + pin.durationMin + ESTIMATED_TRAVEL_MINUTES;
  }
  sequenced.push(...free);

  return [
    ...others,
    ...sequenced.map((planned, index) => ({ ...planned, order: index + 1 })),
  ];
}

/** 로그·프롬프트용 표기 */
export function describeTimeAnchor(anchor: TimeAnchor, candidates: readonly CandidatePlace[]): string {
  const target = anchor.candidateId
    ? (candidates.find((place) => place.id === anchor.candidateId)?.name ?? anchor.candidateId)
    : anchor.category;
  return `${anchor.day}일차 ${anchor.time} ${target}`;
}
