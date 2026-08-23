import { haversineMeters, timeToMinutes } from '@tripick/utils';
import type { CandidatePlace } from '../retrieval/types';
import { ESTIMATED_TRAVEL_MINUTES, defaultVisitDuration } from './itinerary-density';

/**
 * 하루 한 자리(슬롯)가 맡는 역할. 후보를 고를 때 이 역할의 category 를 먼저 찾는다.
 */
export type SlotRole = 'restaurant' | 'cafe' | 'attraction';

/**
 * 역할별 목표 시각과 허용 구간(분, 자정 기준). 슬롯의 **시작 시각**으로 판정한다.
 *
 * 목표 시각을 따로 두는 이유 — 구간 안에서 처음 걸리는 슬롯을 그냥 집으면 활동 구간이 이른
 * 여행에서 점심이 11:00 에 박힌다. 구간 안에서 목표에 가장 가까운 슬롯을 고르면 실제 식사
 * 시간대로 붙는다.
 */
const SLOT_WINDOWS = {
  lunch: { target: 12 * 60 + 30, from: 11 * 60, to: 14 * 60 + 30 },
  dinner: { target: 18 * 60 + 30, from: 16 * 60 + 30, to: 21 * 60 },
  cafe: { target: 15 * 60 + 30, from: 13 * 60, to: 18 * 60 },
} as const;

/**
 * 카페 슬롯을 두는 최소 하루 항목 수. 3개짜리 하루에 카페를 넣으면 볼거리가 2개로 줄어
 * "여행지를 둘러본다"가 성립하지 않는다. (프롬프트의 "카페는 하루 최대 1개" 와 같은 기준)
 */
const MIN_ITEMS_FOR_CAFE_SLOT = 4;

/** 역할 매칭에 쓰는 category. 풀의 category 값과 그대로 비교한다. */
const ROLE_CATEGORY: Record<SlotRole, string> = {
  restaurant: 'restaurant',
  cafe: 'cafe',
  attraction: 'attraction',
};

const DINING_CATEGORIES: ReadonlySet<string> = new Set(['restaurant', 'cafe']);

/**
 * 역할 후보를 근접 창 밖(풀 전체)에서 찾을 때 허용하는 그 일차 기점으로부터의 최대 거리(m).
 *
 * 창 안에 식사 후보가 없으면 풀 전체를 훑는데, 이 상한이 없으면 체인 반대쪽 끝(다른 시군구)의
 * 음식점을 끌어와 그 일차 동선이 통째로 벌어진다. 50km 는 대중교통 실효속도(20km/h)로 약
 * 150분이라 `ConstraintEngine` 의 구간 이동 상한(180분) 안쪽에 들어온다 — 두 값이 어긋나면
 * 여기서 고른 후보를 저쪽이 위반으로 떨궈 재생성만 반복한다.
 */
const MAX_ROLE_DETOUR_M = 50_000;

/**
 * 하루 슬롯의 역할을 정한다.
 *
 * 왜 코드에 있어야 하나 — 예전엔 "점심/저녁엔 음식점, 카페는 휴식 슬롯" 이 LLM 프롬프트 문장
 * 하나로만 존재했다. 결정적 배치 경로(LLM 실패·제약 재생성)는 후보를 점수 순으로 자르기만 해서
 * 하루가 통째로 관광지로 채워졌고(실측: 해운대 2일차 attraction 6 / restaurant 0 / cafe 0),
 * LLM 은 애초에 각 order 가 몇 시에 걸리는지 모른다(시각은 buildDraft 가 나중에 계산한다).
 *
 * 시각은 "체류 + 이동" 을 누적한 **추정치**다. 실제 배치는 영업시간 정렬·실 이동시간으로
 * 다시 계산되므로 정확히 일치하지는 않지만, 식사 슬롯이 존재하느냐 아니냐를 가르기엔 충분하다.
 */
export function daySlotRoles(startTime: string, itemCount: number): SlotRole[] {
  if (itemCount <= 0) return [];

  // 1차: 역할을 모르는 상태의 명목 시작 시각. 역할별 체류시간 차이는 30분 남짓이라
  // 어느 슬롯이 식사 시간대에 걸리는지 가르는 데는 일반 체류시간으로 충분하다.
  const nominalStarts: number[] = [];
  let at = timeToMinutes(startTime);
  for (let index = 0; index < itemCount; index += 1) {
    nominalStarts.push(at);
    at += defaultVisitDuration('attraction') + ESTIMATED_TRAVEL_MINUTES;
  }

  const roles: SlotRole[] = new Array<SlotRole>(itemCount).fill('attraction');
  const taken = new Set<number>();
  const assign = (window: (typeof SLOT_WINDOWS)[keyof typeof SLOT_WINDOWS], role: SlotRole) => {
    let best = -1;
    let bestDistance = Infinity;
    nominalStarts.forEach((start, index) => {
      if (taken.has(index)) return;
      if (start < window.from || start > window.to) return;
      const distance = Math.abs(start - window.target);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    if (best < 0) return;
    taken.add(best);
    roles[best] = role;
  };

  // 식사가 카페보다 먼저다 — 구간이 겹치는 자리를 카페가 먼저 가져가면 끼니가 빠진다.
  assign(SLOT_WINDOWS.lunch, 'restaurant');
  assign(SLOT_WINDOWS.dinner, 'restaurant');
  if (itemCount >= MIN_ITEMS_FOR_CAFE_SLOT) assign(SLOT_WINDOWS.cafe, 'cafe');

  return roles;
}

export interface FillDaySlotsParams {
  /** 후보 풀. 앞쪽이 우선(CRAG 순위 또는 근접 체인 순서)이라고 가정한다. */
  pool: CandidatePlace[];
  /** 이미 다른 일차·다른 슬롯이 가져간 후보 id. **호출자와 공유하며 이 함수가 채운다.** */
  used: Set<string>;
  /** 이 일차 계획 시작 시각("HH:MM") */
  startTime: string;
  /** 이 일차에 담을 항목 수 */
  itemCount: number;
  /**
   * 역할에 맞는 후보를 찾을 풀 앞쪽 범위(미사용 기준 개수). 미지정이면 풀 전체.
   *
   * 근접 체인 순서로 들어온 풀에서 이걸 안 걸면, 하루의 식사 자리를 체인 반대쪽 끝에 있는
   * 음식점이 채워 그 일차 동선이 통째로 벌어진다. 창 안에 역할 후보가 없을 때만 전체를 훑고,
   * 그때도 `MAX_ROLE_DETOUR_M` 안쪽만 받는다.
   */
  searchWindow?: number;
  /** 앞에서부터 이미 정해진 후보(AI 가 고른 항목). 남은 슬롯만 역할로 채운다. */
  preassigned?: CandidatePlace[];
}

/**
 * 하루 슬롯을 후보로 채운다. 반환 배열의 index 가 곧 방문 순서다.
 *
 * 채우는 순서가 **역할 먼저, 나머지 나중**인 것이 핵심 — 앞에서부터 순위대로 자르면 상위가
 * 관광지로 가득한 풀에서 식음 후보는 언제나 꼬리에 남아 한 번도 안 뽑힌다.
 */
export function fillDaySlots(params: FillDaySlotsParams): CandidatePlace[] {
  const { pool, used, startTime, itemCount, searchWindow, preassigned = [] } = params;
  if (itemCount <= 0) return [];

  const roles = daySlotRoles(startTime, itemCount);
  const slots: Array<CandidatePlace | undefined> = new Array<CandidatePlace | undefined>(itemCount);

  preassigned.slice(0, itemCount).forEach((candidate, index) => {
    slots[index] = candidate;
    used.add(candidate.id);
  });

  // 그 일차의 지리적 기점 — 근접 체인에서 아직 안 쓴 첫 후보가 곧 하루의 출발점이다.
  const dayOrigin = pool.find((candidate) => !used.has(candidate.id))?.coordinates;
  const withinDetour = (candidate: CandidatePlace): boolean =>
    !dayOrigin || haversineMeters(dayOrigin, candidate.coordinates) <= MAX_ROLE_DETOUR_M;

  const take = (match: (candidate: CandidatePlace) => boolean, window?: number): CandidatePlace | undefined => {
    let scanned = 0;
    for (const candidate of pool) {
      if (used.has(candidate.id)) continue;
      if (window !== undefined && scanned >= window) break;
      scanned += 1;
      if (!match(candidate)) continue;
      used.add(candidate.id);
      return candidate;
    }
    return undefined;
  };

  // 1) 식사·카페 슬롯을 먼저 채운다. 근접 창 안에 없으면 풀 전체에서 찾는다 —
  //    동선이 조금 벌어지는 것보다 끼니가 통째로 빠지는 쪽이 나쁘다.
  for (let index = 0; index < itemCount; index += 1) {
    if (slots[index]) continue;
    const role = roles[index]!;
    if (role === 'attraction') continue;
    const category = ROLE_CATEGORY[role];
    const matches = (candidate: CandidatePlace) => candidate.category === category;
    // 창 안에 없으면 풀 전체를 훑되, 하루 동선을 벌리는 거리까지 가지는 않는다.
    slots[index] =
      take(matches, searchWindow) ??
      take((candidate) => matches(candidate) && withinDetour(candidate));
  }

  // 2) 나머지 슬롯은 볼거리 우선, 없으면 남은 아무 후보로 채운다.
  for (let index = 0; index < itemCount; index += 1) {
    if (slots[index]) continue;
    const sightseeing = (candidate: CandidatePlace) => !DINING_CATEGORIES.has(candidate.category);
    slots[index] =
      take(sightseeing, searchWindow) ??
      take((candidate) => sightseeing(candidate) && withinDetour(candidate)) ??
      take(withinDetour) ??
      take(() => true);
  }

  return slots.filter((candidate): candidate is CandidatePlace => candidate !== undefined);
}
