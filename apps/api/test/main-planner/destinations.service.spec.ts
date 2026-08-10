/// <reference types="jest" />

import type { DestinationSuggestionDto } from '@tripick/types';
import { DestinationsService } from '../../src/main-planner/destinations.service';
import type { PopularityIndex } from '../../src/planner/retrieval/types';
import type { RegionRecommendation } from '../../src/planner/retrieval/place-embedding.repository';

/**
 * search / recommend 랭킹 로직 커버리지.
 * KTO 지역 목록 fetch(getAll)는 얇은 axios 래퍼라 인스턴스에서 스텁하고,
 * 순수 랭킹(인기 폴백·계절 코퍼스 랭킹·취향 벡터 랭킹·시군구 대표 접기)만 검증한다.
 */

/** 계절 코퍼스 인덱스 목: label→언급수 맵으로 mentions/score 를 만든다. */
function seasonalIndex(mentionsByLabel: Record<string, number>, docCount = 5): PopularityIndex {
  const max = Math.max(1, ...Object.values(mentionsByLabel));
  return {
    docCount,
    mentions: (name: string) => mentionsByLabel[name] ?? 0,
    score: (name: string) => (mentionsByLabel[name] ?? 0) / max,
  };
}

function setup(opts: {
  all?: DestinationSuggestionDto[];
  seasonal?: PopularityIndex;
  vector?: number[] | null;
  regions?: RegionRecommendation[];
} = {}) {
  const preferences = {
    getPreferenceVector: jest.fn(async () => opts.vector ?? null),
  };
  const placeEmbeddings = {
    recommendRegions: jest.fn(async () => opts.regions ?? []),
  };
  const naver = {
    getSeasonalDestinationIndex: jest.fn(async () => opts.seasonal ?? seasonalIndex({}, 0)),
  };
  const config = { get: <T>(_k: string, d?: T) => d };

  const service = new DestinationsService(
    config as never,
    preferences as never,
    placeEmbeddings as never,
    naver as never,
  );
  // KTO fetch 를 우회하고 랭킹 로직에 지역 목록을 직접 주입한다.
  (service as unknown as { getAll: () => Promise<DestinationSuggestionDto[]> }).getAll = async () =>
    opts.all ?? [];
  return { service, preferences, placeEmbeddings, naver };
}

const CATALOG: DestinationSuggestionDto[] = [
  { id: 'sido-1', name: '서울특별시', region: '서울특별시' },
  { id: 'sido-26', name: '부산광역시', region: '부산광역시' },
  { id: '26-260', name: '해운대구', region: '부산광역시' },
  { id: 'sido-42', name: '강원특별자치도', region: '강원특별자치도' },
  { id: '42-420', name: '강릉시', region: '강원특별자치도' },
  { id: 'sido-47', name: '경상북도', region: '경상북도' },
  { id: '47-470', name: '경주시', region: '경상북도' },
  { id: 'sido-50', name: '제주특별자치도', region: '제주특별자치도' },
];

describe('DestinationsService.search', () => {
  it('빈 질의는 인기 여행지를 우선 노출한다(POPULAR_NAMES 순)', async () => {
    const { service } = setup({ all: CATALOG });
    const res = await service.search('  ');
    // 제주·부산이 서울보다 먼저 (POPULAR_NAMES 우선순위)
    const jeju = res.findIndex((d) => d.name.includes('제주'));
    const seoul = res.findIndex((d) => d.name.includes('서울'));
    expect(jeju).toBeGreaterThanOrEqual(0);
    expect(jeju).toBeLessThan(seoul);
  });

  it('질의는 name·region 부분일치로 거른다', async () => {
    const { service } = setup({ all: CATALOG });
    const res = await service.search('부산');
    // '부산광역시' 와 region 이 부산인 '해운대구' 둘 다 매칭
    const names = res.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(['부산광역시', '해운대구']));
    expect(res.every((d) => d.name.includes('부산') || d.region.includes('부산'))).toBe(true);
  });
});

describe('DestinationsService.recommend — 계절 코퍼스 경로', () => {
  it('코퍼스에 언급된 여행지를 계절 점수 순으로 노출한다(취향 없음)', async () => {
    const seasonal = seasonalIndex({ 강릉: 9, 경주: 3, 부산: 1 });
    const { service } = setup({ all: CATALOG, seasonal, vector: null });

    const res = await service.recommend('u1');

    // 언급 0 인 서울/제주는 계절 후보가 아니고, 언급된 것 중 강릉이 최상단
    expect(res[0]?.name).toBe('강릉');
    const names = res.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(['강릉', '경주', '부산']));
  });

  it('취향 점수가 있으면 계절 점수와 결합해 순위를 끌어올린다', async () => {
    const seasonal = seasonalIndex({ 강릉: 9, 경주: 1 });
    // 경주(경상북도)에 높은 취향 점수 → 계절 언급이 낮아도 강릉을 역전
    const regions: RegionRecommendation[] = [
      { region: '경상북도', sigungu: '경주시', score: 0.99, places: 20 },
      { region: '강원특별자치도', sigungu: '강릉시', score: 0.1, places: 20 },
    ];
    const { service } = setup({ all: CATALOG, seasonal, vector: [0.1, 0.2], regions });

    const res = await service.recommend('u1');

    expect(res[0]?.name).toBe('경주');
  });
});

describe('DestinationsService.recommend — 취향 벡터 폴백 경로', () => {
  it('계절 코퍼스가 비고 취향 벡터도 없으면 인기 여행지로 폴백한다', async () => {
    const { service, placeEmbeddings } = setup({ all: CATALOG, seasonal: seasonalIndex({}, 0), vector: null });

    const res = await service.recommend('u1');

    expect(placeEmbeddings.recommendRegions).not.toHaveBeenCalled();
    // 인기 폴백 → 제주가 앞쪽
    expect(res.some((d) => d.name.includes('제주'))).toBe(true);
  });

  it('취향 벡터로 시도별 대표(시군구 우선)를 뽑아 점수순 노출한다', async () => {
    const regions: RegionRecommendation[] = [
      // 같은 부산 시도: 시도 전체(시군구 없음)보다 시군구(해운대) 우선
      { region: '부산광역시', sigungu: null, score: 0.95, places: 30 },
      { region: '부산광역시', sigungu: '해운대구', score: 0.8, places: 15 },
      { region: '경상북도', sigungu: '경주시', score: 0.9, places: 15 },
    ];
    const { service } = setup({ all: CATALOG, seasonal: seasonalIndex({}, 0), vector: [0.3], regions });

    const res = await service.recommend('u1');

    const names = res.map((d) => d.name);
    // 추천 경로의 부산 대표는 시군구(해운대구)로 접힌다. '부산광역시'는 이후 인기 폴백으로만
    // 뒤에 붙으므로, 해운대구가 그보다 앞선다는 것으로 시군구 우선 접기를 확인한다.
    expect(names).toContain('해운대구');
    expect(names).toContain('경주시');
    expect(names.indexOf('해운대구')).toBeLessThan(names.indexOf('부산광역시'));
  });
});
