/// <reference types="jest" />

import { collapseNearDuplicates } from '../../../src/planner/retrieval/near-duplicate';

interface Row {
  name: string;
  category: string;
  coordinates: { lat: number; lng: number };
}

const place = (name: string, lat: number, lng: number, category = 'attraction'): Row => ({
  name,
  category,
  coordinates: { lat, lng },
});

const names = (rows: Row[], destination: string): string[] =>
  collapseNearDuplicates(rows, destination).map((row) => row.name);

describe('collapseNearDuplicates', () => {
  it('이름이 같으면 좌표가 떨어져 있어도 접는다 (카드에선 구분이 안 된다)', () => {
    // 카탈로그 실측: '한라산' 이 제주시·서귀포시 등록으로 두 행(1.9km 차이).
    const rows = [place('한라산', 33.37666, 126.54244), place('한라산', 33.36142, 126.52942)];
    expect(names(rows, '제주')).toEqual(['한라산']);
  });

  it('공백·목적지 접두만 다른 이름을 같은 이름으로 본다', () => {
    expect(
      names([place('광주양동시장', 35.15454, 126.90196), place('광주 양동시장', 35.15425, 126.90223)], '광주'),
    ).toEqual(['광주양동시장']);
    expect(
      names([place('황리단길', 35.83933, 129.20965), place('경주 황리단길', 35.83741, 129.20995)], '경주'),
    ).toEqual(['황리단길']);
  });

  it('포함 관계 + 근거리 + 같은 카테고리면 접고, 대표는 짧은 이름을 남긴다', () => {
    // 점수 상위(입력 앞)가 부속 시설이어도 일정 카드엔 본관 이름이 맞다.
    const rows = [
      place('국립경주박물관 특별전시관', 35.82944, 129.22867),
      place('국립경주박물관', 35.82923, 129.22795),
      place('국립경주박물관 어린이박물관', 35.82957, 129.22875),
    ];
    expect(names(rows, '경주')).toEqual(['국립경주박물관']);
  });

  it('전이적으로 묶는다 — 부속끼리는 서로를 포함하지 않아도 한 무리다', () => {
    const rows = [
      place('한라산', 33.37666, 126.54244),
      place('한라산국립공원', 33.37669, 126.54218),
      place('한라산 동능', 33.36098, 126.53574),
    ];
    expect(names(rows, '제주')).toEqual(['한라산']);
  });

  it('긴 이름이 서로 무관한 짧은 이름 둘을 잇지 못한다 (다리 병합 금지)', () => {
    // 실측(속초): '속초해수욕장' 과 '속초아이' 는 서로를 포함하지 않는 다른 장소인데,
    // '속초해수욕장 대관람차(속초아이)' 가 다리가 되어 한 무리로 묶이고 대표가 대관람차 쪽으로
    // 뽑혀 **해수욕장이 후보에서 통째로 사라졌다**(골든셋 sokcho 정답 하나가 채점 풀에서 소실).
    const rows = [
      place('속초해수욕장', 38.2007, 128.5945),
      place('속초해수욕장 대관람차(속초아이)', 38.2011, 128.5951),
      place('속초아이', 38.2012, 128.5952),
    ];
    const kept = names(rows, '속초');
    expect(kept).toContain('속초해수욕장');
    expect(kept).toContain('속초아이');
    // 다리 이름은 둘 중 하나에 접혀 사라진다.
    expect(kept).not.toContain('속초해수욕장 대관람차(속초아이)');
  });

  it('멀리 떨어진 동명 지역 명소는 남긴다 (포함 관계는 2km 안에서만)', () => {
    // 한라산1100고지는 한라산에서 7.3km — 실제로 다른 방문지다.
    const rows = [place('한라산', 33.37666, 126.54244), place('한라산1100고지', 33.35808, 126.46222)];
    expect(names(rows, '제주')).toEqual(['한라산', '한라산1100고지']);
  });

  it('명소 이름을 딴 가게는 카테고리가 달라 살아남는다', () => {
    const rows = [
      place('이순신광장', 34.73945, 127.73605),
      place('카페모카 힐 이순신광장점', 34.73815, 127.74227, 'cafe'),
    ];
    expect(names(rows, '여수')).toEqual(['이순신광장', '카페모카 힐 이순신광장점']);
  });

  it('2글자 이름의 우연한 포함으로는 접지 않는다', () => {
    // 짧은 상호(카페 '연다')가 옆 가게 이름에 들어 있다는 이유로 사라지면 안 된다.
    const rows = [place('연다', 35.8, 129.2, 'cafe'), place('연다방', 35.801, 129.201, 'cafe')];
    expect(names(rows, '경주')).toHaveLength(2);
  });

  it('입력의 점수 정렬을 그대로 유지한다', () => {
    const rows = [
      place('첨성대', 35.83471, 129.219),
      place('대릉원', 35.8391, 129.2126),
      place('경주 첨성대', 35.83433, 129.21853),
      place('불국사', 35.7901, 129.3321),
    ];
    expect(names(rows, '경주')).toEqual(['첨성대', '대릉원', '불국사']);
  });
});
