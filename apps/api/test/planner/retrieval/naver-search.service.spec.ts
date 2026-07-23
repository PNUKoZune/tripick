/// <reference types="jest" />

import axios from 'axios';
import {
  NaverPopularityIndex,
  NaverSearchService,
  NEUTRAL_POPULARITY,
} from '../../../src/planner/retrieval/naver-search.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function config(values: Record<string, string>) {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as any;
}

describe('NaverPopularityIndex', () => {
  const corpus =
    '경주 여행지 추천! <b>불국사</b> 와 석굴암은 필수, 불국사 야경도 좋아요. ' +
    '동궁과 월지(안압지) 산책 코스, 다시 불국사 방문기.';
  const index = new NaverPopularityIndex(corpus, 3);

  it('counts how many times a clean place name appears in the corpus', () => {
    expect(index.mentions('불국사')).toBe(3);
    expect(index.mentions('석굴암')).toBe(1);
  });

  it('absorbs spacing differences (동궁과 월지 vs 동궁과월지)', () => {
    expect(index.mentions('동궁과월지')).toBe(1);
  });

  it('returns 0 for a minor place never mentioned', () => {
    expect(index.mentions('무명 골목 카페')).toBe(0);
  });

  it('scores frequent places higher than rarely mentioned ones', () => {
    expect(index.score('불국사')).toBeGreaterThan(index.score('석굴암'));
  });

  it('gives an unmentioned place a low soft score, not zero', () => {
    const score = index.score('무명 골목 카페');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.3);
  });

  it('ignores 1-character names to avoid false positives', () => {
    expect(new NaverPopularityIndex('산 바다 강', 1).mentions('산')).toBe(0);
  });
});

describe('NaverSearchService', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns a disabled (neutral) index when credentials are missing', async () => {
    const service = new NaverSearchService(config({}));
    const index = await service.getPopularityIndex('경주');

    expect(index.docCount).toBe(0);
    expect(index.score('불국사')).toBe(NEUTRAL_POPULARITY);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('builds an index from blog + cafe results and caches per destination', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { items: [{ title: '경주 <b>불국사</b> 후기', description: '불국사 최고' }] },
    });
    const service = new NaverSearchService(
      config({ NAVER_SEARCH_CLIENT_ID: 'id', NAVER_SEARCH_CLIENT_SECRET: 'secret' }),
    );

    const index = await service.getPopularityIndex('경주');
    expect(index.mentions('불국사')).toBeGreaterThan(0);
    const callsAfterFirst = mockedAxios.get.mock.calls.length;

    // 같은 목적지 재조회는 캐시를 써 추가 HTTP 호출이 없어야 한다.
    await service.getPopularityIndex('경주');
    expect(mockedAxios.get.mock.calls.length).toBe(callsAfterFirst);
  });

  it('keeps the succeeding endpoint corpus when the other endpoint fails', async () => {
    mockedAxios.get.mockImplementation((url: string) =>
      url.includes('/cafearticle')
        ? Promise.reject(new Error('cafe down'))
        : Promise.resolve({
            data: { items: [{ title: '경주 <b>불국사</b> 후기', description: '불국사 최고' }] },
          }),
    );
    const service = new NaverSearchService(
      config({ NAVER_SEARCH_CLIENT_ID: 'id', NAVER_SEARCH_CLIENT_SECRET: 'secret' }),
    );

    const index = await service.getPopularityIndex('경주');
    expect(index.docCount).toBeGreaterThan(0);
    expect(index.mentions('불국사')).toBeGreaterThan(0);
  });

  it('falls back to a neutral index when the search call fails', async () => {
    mockedAxios.get.mockRejectedValue(new Error('network'));
    const service = new NaverSearchService(
      config({ NAVER_SEARCH_CLIENT_ID: 'id', NAVER_SEARCH_CLIENT_SECRET: 'secret' }),
    );

    const index = await service.getPopularityIndex('부산');
    expect(index.docCount).toBe(0);
    expect(index.score('해운대')).toBe(NEUTRAL_POPULARITY);
  });
});
