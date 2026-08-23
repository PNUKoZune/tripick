/// <reference types="jest" />

import {
  daySlotRoles,
  fillDaySlots,
} from '../../../src/planner/helpers/day-slot-planner';
import type { CandidatePlace } from '../../../src/planner/retrieval/types';

describe('daySlotRoles', () => {
  it('종일 일정에 점심·저녁 음식점과 오후 카페 자리를 만든다', () => {
    const roles = daySlotRoles('09:00', 6);

    expect(roles.filter((role) => role === 'restaurant')).toHaveLength(2);
    expect(roles.filter((role) => role === 'cafe')).toHaveLength(1);
    // 첫 자리는 아침이라 볼거리다 — 기상 직후 슬롯에 식사를 박지 않는다.
    expect(roles[0]).toBe('attraction');
  });

  it('식사 자리는 구간 안에서 목표 시각에 가장 가까운 슬롯이다', () => {
    // 09:00 시작 · 슬롯 간 150분 → 명목 시작 09:00 / 11:30 / 14:00 / 16:30 / 19:00 / 21:30
    const roles = daySlotRoles('09:00', 6);

    // 점심 목표 12:30 → 11:30(60분 차)이 14:00(90분 차)보다 가깝다.
    expect(roles[1]).toBe('restaurant');
    // 저녁 목표 18:30 → 19:00.
    expect(roles[4]).toBe('restaurant');
  });

  it('하루가 저녁부터 시작하면 그 한 자리를 저녁 식사로 쓴다', () => {
    expect(daySlotRoles('19:30', 1)).toEqual(['restaurant']);
  });

  it('하루 항목이 3개 이하면 카페 자리를 만들지 않는다', () => {
    // 볼거리가 2개로 줄어 "여행지를 둘러본다"가 성립하지 않는다.
    expect(daySlotRoles('09:00', 3)).not.toContain('cafe');
  });
});

describe('fillDaySlots', () => {
  it('점수 상위가 전부 관광지여도 식사·카페 후보를 끌어올린다', () => {
    // 실제 풀의 모양 — selectTopDiverse 가 식음을 꼬리 자리에 채워 넣기 때문에,
    // 앞에서부터 자르던 예전 배치는 이 후보들을 한 번도 못 뽑았다.
    const pool = [
      ...attractions(10),
      place('r0', 'restaurant'),
      place('c0', 'cafe'),
    ];

    const picks = fillDaySlots({ pool, used: new Set(), startTime: '09:00', itemCount: 6 });

    expect(picks).toHaveLength(6);
    expect(picks.filter((place) => place.category === 'restaurant')).toHaveLength(1);
    expect(picks.filter((place) => place.category === 'cafe')).toHaveLength(1);
    expect(picks[1]!.id).toBe('r0');
  });

  it('일차끼리 used 를 공유해 같은 장소를 두 번 담지 않는다', () => {
    const pool = [
      ...attractions(8),
      ...['r0', 'r1', 'r2', 'r3'].map((id) => place(id, 'restaurant')),
    ];
    const used = new Set<string>();

    const day1 = fillDaySlots({ pool, used, startTime: '09:00', itemCount: 5 });
    const day2 = fillDaySlots({ pool, used, startTime: '09:00', itemCount: 5 });

    const ids = [...day1, ...day2].map((place) => place.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(day2.some((place) => place.category === 'restaurant')).toBe(true);
  });

  it('역할에 맞는 후보가 없으면 그 자리를 볼거리로 메운다 (자리를 비우지 않는다)', () => {
    const picks = fillDaySlots({
      pool: attractions(6),
      used: new Set(),
      startTime: '09:00',
      itemCount: 5,
    });

    expect(picks).toHaveLength(5);
    expect(picks.every((place) => place.category === 'attraction')).toBe(true);
  });

  it('근접 창 밖에 있어도 가까우면 식사 후보를 끌어온다 — 끼니가 빠지는 쪽이 더 나쁘다', () => {
    // 앞쪽(근접 체인 머리)은 전부 관광지, 음식점은 체인 반대쪽 끝에 있다.
    const pool = [...attractions(20), place('r0', 'restaurant')];

    const picks = fillDaySlots({
      pool,
      used: new Set(),
      startTime: '09:00',
      itemCount: 4,
      searchWindow: 8,
    });

    expect(picks.map((place) => place.id)).toContain('r0');
  });

  it('풀 전체를 훑을 때도 하루 동선을 벌리는 거리까지는 안 간다', () => {
    // 근접 창 밖 폴백에 거리 상한이 없으면 다른 시군구의 음식점을 끌어와, ConstraintEngine
    // 구간 이동 상한(180분)에 걸려 재생성만 반복하게 된다.
    const faraway = { ...place('r-far', 'restaurant'), coordinates: { lat: 36.98, lng: 128.37 } };
    const picks = fillDaySlots({
      pool: [...attractions(20), faraway],
      used: new Set(),
      startTime: '09:00',
      itemCount: 4,
      searchWindow: 8,
    });

    expect(picks.map((item) => item.id)).not.toContain('r-far');
    expect(picks).toHaveLength(4);
  });

  it('AI 가 채운 자리는 그대로 두고 남은 자리만 역할로 메운다', () => {
    const pool = [...attractions(6), place('r0', 'restaurant')];
    const preassigned = [pool[0]!, pool[1]!];

    const picks = fillDaySlots({
      pool,
      used: new Set(preassigned.map((place) => place.id)),
      startTime: '09:00',
      itemCount: 5,
      preassigned,
    });

    expect(picks.slice(0, 2).map((place) => place.id)).toEqual(['a0', 'a1']);
    expect(picks).toHaveLength(5);
    expect(picks.some((place) => place.category === 'restaurant')).toBe(true);
  });
});

function attractions(count: number): CandidatePlace[] {
  return Array.from({ length: count }, (_, index) => place(`a${index}`, 'attraction'));
}

/**
 * 우천 배려가 LLM 프롬프트 문장 하나로만 존재하던 시절엔, LLM 이 죽는 순간(타임아웃·미기동)
 * 비 오는 날에도 해수욕장이 그대로 배치됐다. 결정적 경로가 같은 정보를 읽어야 한다.
 */
describe('fillDaySlots 우천 배려', () => {
  it('비 오는 날은 볼거리 자리에 실내를 먼저 집는다', () => {
    const pool = [
      named('해운대해수욕장', 'attraction'),
      named('국립부산과학관', 'attraction'),
      named('기장 식당', 'restaurant'),
    ];

    const dry = fillDaySlots({ pool, used: new Set(), startTime: '09:00', itemCount: 1 });
    const wet = fillDaySlots({
      pool,
      used: new Set(),
      startTime: '09:00',
      itemCount: 1,
      preferIndoor: true,
    });

    expect(dry[0]!.name).toBe('해운대해수욕장');
    expect(wet[0]!.name).toBe('국립부산과학관');
  });

  /** 소프트 선호다 — 실내가 없다고 하루를 비우면 안 된다. */
  it('창 안에 실내가 없으면 야외를 그대로 쓴다 (후보를 버리지 않는다)', () => {
    const pool = [named('해운대해수욕장', 'attraction'), named('광안리해변', 'attraction')];

    const wet = fillDaySlots({
      pool,
      used: new Set(),
      startTime: '09:00',
      itemCount: 2,
      preferIndoor: true,
    });

    expect(wet).toHaveLength(2);
  });

  it('판정 불가(unknown)는 야외보다 먼저 온다 — 모르는 걸 야외로 몰지 않는다', () => {
    const pool = [named('해운대해수욕장', 'attraction'), named('불국사', 'attraction')];

    const wet = fillDaySlots({
      pool,
      used: new Set(),
      startTime: '09:00',
      itemCount: 1,
      preferIndoor: true,
    });

    expect(wet[0]!.name).toBe('불국사');
  });

  it('식사 슬롯은 날씨와 무관하다 — 끼니를 비 때문에 미루면 그게 더 나쁘다', () => {
    const pool = [
      named('국립부산과학관', 'attraction'),
      named('기장 식당', 'restaurant'),
      named('광안리 카페', 'cafe'),
      named('해운대해수욕장', 'attraction'),
    ];

    const wet = fillDaySlots({
      pool,
      used: new Set(),
      startTime: '09:00',
      itemCount: 4,
      preferIndoor: true,
    });

    expect(wet.map((candidate) => candidate.category)).toEqual([
      'attraction',
      'restaurant',
      'cafe',
      'attraction',
    ]);
  });

  /**
   * 실내 선호로 근접 창을 넓히면 비를 피하려다 하루 동선이 벌어져 이동시간 상한에 걸린다.
   * 창 밖의 실내보다 창 안의 야외가 낫다.
   */
  it('실내를 찾겠다고 근접 창 밖까지 훑지 않는다', () => {
    const pool = [
      named('해운대해수욕장', 'attraction'),
      named('광안리해변', 'attraction'),
      named('국립부산과학관', 'attraction'), // 창(2) 밖
    ];

    const wet = fillDaySlots({
      pool,
      used: new Set(),
      startTime: '09:00',
      itemCount: 1,
      searchWindow: 2,
      preferIndoor: true,
    });

    expect(wet[0]!.name).toBe('해운대해수욕장');
  });
});

/** 이름으로 우천 노출도가 갈리는 후보. 좌표는 모두 같아 거리 상한은 개입하지 않는다. */
function named(name: string, category: string): CandidatePlace {
  return { ...place(name, category), name };
}

function place(id: string, category: string): CandidatePlace {
  return {
    id,
    name: id,
    category,
    address: '부산 어딘가',
    coordinates: { lat: 35.15, lng: 129.11 },
    source: 'pgvector',
    tags: [],
    confidence: 0.8,
    reason: 'fixture',
    crag: {
      total: 0.8,
      retrieval: 0.8,
      taste: 0.8,
      locality: 0.8,
      context: 0.8,
      availability: 0.8,
      popularity: 0.5,
      matchedTags: [],
      penalties: [],
    },
  };
}
