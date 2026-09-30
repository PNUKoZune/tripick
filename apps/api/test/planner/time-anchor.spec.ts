/// <reference types="jest" />

import {
  applyTimeAnchors,
  matchCandidateByName,
  parseTimeAnchors,
  pinnedDayCapacity,
} from '../../src/planner/helpers/time-anchor';
import type { PlannedCandidate } from '../../src/planner/agent/planner-agent.service';
import type { CandidatePlace } from '../../src/planner/retrieval/types';

function place(id: string, name: string, category = 'attraction'): CandidatePlace {
  return {
    id,
    name,
    category,
    address: '부산',
    coordinates: { lat: 35.15, lng: 129.11 },
    tags: [],
    confidence: 0.9,
    source: 'fixture',
    reason: '',
  } as unknown as CandidatePlace;
}

function planned(candidate: CandidatePlace, order: number, durationMin = 120): PlannedCandidate {
  return { candidate, day: 1, order, durationMin, memo: '', aiGenerated: true };
}

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

describe('parseTimeAnchors', () => {
  it.each([
    ['카페 12시에 추가해줘', '12:00', 'cafe'],
    ['12시 반에 카페', '12:30', 'cafe'],
    ['오후 3시에 커피 한잔', '15:00', 'cafe'],
    ['3시에 디저트 먹고 싶어', '15:00', 'cafe'],
    ['저녁 7시에 맛집 가고 싶어', '19:00', 'restaurant'],
    ['12:30 점심', '12:30', 'restaurant'],
    ['열두시에 카페', '12:00', 'cafe'],
    ['오전 10시 박물관 구경', '10:00', 'sightseeing'],
    ['18시 20분에 식당', '18:20', 'restaurant'],
  ])('"%s" → %s %s', (note, time, category) => {
    const [anchor] = parseTimeAnchors(note);
    expect(anchor && clock(anchor.minutes)).toBe(time);
    expect(anchor?.category).toBe(category);
  });

  it('시각이 여럿이면 각자 자기 문맥의 종류를 갖는다', () => {
    const anchors = parseTimeAnchors('12시에 카페 들르고 저녁 7시에 식당 가자');
    expect(anchors.map((anchor) => [clock(anchor.minutes), anchor.category])).toEqual([
      ['12:00', 'cafe'],
      ['19:00', 'restaurant'],
    ]);
  });

  it('일차를 짚으면 그 일차로 잡는다', () => {
    expect(parseTimeAnchors('2일차 3시에 카페')[0]?.day).toBe(2);
  });

  it('체류 길이("2시간")는 시각이 아니다', () => {
    expect(parseTimeAnchors('카페에서 2시간 쉬고 싶어')).toEqual([]);
    expect(parseTimeAnchors('한 시간 정도 카페')).toEqual([]);
  });

  it('제외 요청은 고정하지 않는다', () => {
    expect(parseTimeAnchors('12시 카페는 빼줘')).toEqual([]);
  });

  it('시각이 없으면 비어 있다', () => {
    expect(parseTimeAnchors('카페 하나 추가해줘')).toEqual([]);
    expect(parseTimeAnchors(null)).toEqual([]);
  });
});

describe('matchCandidateByName', () => {
  it('공백을 무시하고 가장 긴 이름을 고른다', () => {
    const short = place('a', '해운대');
    const long = place('b', '해운대 블루라인파크');
    expect(matchCandidateByName('3시에 해운대블루라인파크 가자', [short, long])).toBe(long);
    expect(matchCandidateByName('3시에 해운대 가자', [short, long])).toBe(short);
  });
});

describe('applyTimeAnchors', () => {
  const base = {
    dayStartTime: () => '08:30',
    dayItemTarget: () => 4,
  };

  it('이미 있는 카페를 지정 시각으로 옮기고, 그 앞엔 시각 전에 끝나는 항목만 둔다', () => {
    const a1 = place('a1', '관광 1');
    const a2 = place('a2', '관광 2');
    const cafe = place('c1', '카페', 'cafe');
    const a3 = place('a3', '관광 3');
    const { plan, unresolved } = applyTimeAnchors({
      ...base,
      plan: [planned(a1, 1), planned(a2, 2), planned(cafe, 3, 60), planned(a3, 4)],
      anchors: [{ day: 1, time: '12:00', category: 'cafe' }],
      poolForDay: () => [],
      allCandidates: [],
    });

    expect(unresolved).toEqual([]);
    const ordered = [...plan].sort((a, b) => a.order - b.order);
    // 08:30 + 120 + 30 = 11:00 → 관광 1 은 들어가고, 관광 2 는 12:00 을 넘겨 뒤로 간다.
    expect(ordered.map((item) => item.candidate.name)).toEqual(['관광 1', '카페', '관광 2', '관광 3']);
    expect(ordered[1]!.pinnedAt).toBe('12:00');
    expect(plan.filter((item) => item.candidate.category === 'cafe')).toHaveLength(1);
  });

  it('그 일차에 없으면 풀에서 가져오고, 상한을 넘으면 고정 안 된 항목을 뺀다', () => {
    const items = [1, 2, 3, 4].map((index) => planned(place(`a${index}`, `관광 ${index}`), index));
    const cafe = place('c1', '풀 카페', 'cafe');
    const { plan } = applyTimeAnchors({
      ...base,
      plan: items,
      anchors: [{ day: 1, time: '15:00', category: 'cafe' }],
      poolForDay: () => [place('a9', '관광 9'), cafe],
      allCandidates: [],
    });

    expect(plan).toHaveLength(4);
    expect(plan.find((item) => item.candidate.id === 'c1')?.pinnedAt).toBe('15:00');
  });

  it('필수 포함 장소는 자리를 비울 때도 빼지 않는다', () => {
    const must = planned(place('must-0-1,1', '필수 장소'), 4);
    const items = [1, 2, 3].map((index) => planned(place(`a${index}`, `관광 ${index}`), index));
    const { plan } = applyTimeAnchors({
      ...base,
      plan: [...items, must],
      anchors: [{ day: 1, time: '15:00', category: 'cafe' }],
      poolForDay: () => [place('c1', '카페', 'cafe')],
      allCandidates: [],
    });

    expect(plan.some((item) => item.candidate.id === 'must-0-1,1')).toBe(true);
  });

  it('고정 시각 앞 틈에 원래 체류가 안 들어가면 줄여서 넣는다', () => {
    // 16:00 시작, 18:00 카페 고정. 120분 관광지는 그대로면 18:30 에 끝나 틈에 못 들어간다.
    const { plan } = applyTimeAnchors({
      ...base,
      dayStartTime: () => '16:00',
      plan: [planned(place('a1', '관광 1'), 1), planned(place('c1', '카페', 'cafe'), 2, 60)],
      anchors: [{ day: 1, time: '18:00', category: 'cafe' }],
      poolForDay: () => [],
      allCandidates: [],
    });

    const ordered = [...plan].sort((a, b) => a.order - b.order);
    expect(ordered.map((item) => item.candidate.name)).toEqual(['관광 1', '카페']);
    // 16:00 + 체류 + 이동 30 ≤ 18:00
    expect(ordered[0]!.durationMin).toBe(90);
  });

  it('대상 후보가 없으면 unresolved 로 돌려준다', () => {
    const { unresolved } = applyTimeAnchors({
      ...base,
      plan: [planned(place('a1', '관광 1'), 1)],
      anchors: [{ day: 1, time: '12:00', category: 'cafe' }],
      poolForDay: () => [],
      allCandidates: [],
    });
    expect(unresolved).toHaveLength(1);
  });
});

describe('pinnedDayCapacity', () => {
  const at = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

  it('고정 시각 사이의 틈마다 따로 센다', () => {
    // 16:01 시작, 18:00 카페(60)·19:30 식당(90), 22:00 끝.
    // 16:01~18:00 틈 1곳 + 카페 + (19:00~19:30 틈 0) + 식당 + (21:00 이후 60분 → 첫 이동 빼면 30분, 0)
    expect(
      pinnedDayCapacity({
        startMin: at('16:01'),
        endMin: at('22:00'),
        pins: [
          { atMin: at('18:00'), durationMin: 60 },
          { atMin: at('19:30'), durationMin: 90 },
        ],
      }),
    ).toBe(3);
  });

  it('고정 뒤 남은 시간도 센다', () => {
    // 12:00 카페(60) 뒤 13:00~22:00 은 540분 → 첫 이동 빼고 510분 = 3곳.
    expect(
      pinnedDayCapacity({
        startMin: at('11:30'),
        endMin: at('22:00'),
        pins: [{ atMin: at('12:00'), durationMin: 60 }],
      }),
    ).toBe(4);
  });
});
