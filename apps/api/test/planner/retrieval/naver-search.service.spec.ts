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

describe('NaverPopularityIndex institution-qualifier matching', () => {
  const idx = new NaverPopularityIndex('경주박물관 관람 후기, 경주박물관 주차. 시내 도서관 도서관 카페.', 2);

  it('정식명이 블로그 표현보다 길 때 수식어 뗀 코어로 매칭한다', () => {
    // 블로그는 '경주박물관'으로만 쓰지만 후보 정식명은 '국립경주박물관'
    expect(idx.mentions('국립경주박물관')).toBe(2);
  });

  it('너무 짧은 일반어 코어로는 부풀리지 않는다', () => {
    // '시립도서관'→코어 '도서관'(3<4)이라 코어 매칭 생략 → 정식명 부재로 0
    expect(idx.mentions('시립도서관')).toBe(0);
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

/**
 * 인지도 매칭이 부분문자열이라 짧은 상호는 코퍼스의 흔한 단어를 자기 언급으로 세고,
 * 반대로 지자체가 붙인 긴 등록명은 통째로는 코퍼스에 없어 하한으로 떨어진다.
 * 둘 다 랭킹을 직접 망가뜨린 실측 사례다.
 */
describe('NaverPopularityIndex 매칭 정확도', () => {
  const corpus =
    '대구 여행지 추천 서문시장 야시장 먹거리. 다시 가고 싶은 대구. 서문시장 구경. ' +
    '지금 대구 가면 서문시장. 다시 방문한 근대골목. 국립대구박물관도 좋다.';
  const index = new NaverPopularityIndex(corpus, 5);

  it('2글자 상호는 세지 않고 중립을 준다 (코퍼스의 흔한 단어를 훔치지 못하게)', () => {
    // '다시'·'지금' 은 카카오에 실존하는 대구 식당 상호다. 코퍼스의 부사 '다시' 를
    // 자기 언급으로 세면 인지도 최상위를 먹고 1위에 오른다(실측).
    expect(index.mentions('다시')).toBe(0);
    expect(index.score('다시')).toBe(NEUTRAL_POPULARITY);
    expect(index.score('지금')).toBe(NEUTRAL_POPULARITY);
  });

  it('3글자 이상은 정상적으로 센다 (한국 명소는 3글자가 많다)', () => {
    expect(index.mentions('서문시장')).toBeGreaterThan(1);
    expect(index.mentions('근대골목')).toBe(1);
  });

  it('장식적 등록명은 토큰 코어로 폴백한다', () => {
    // '대구 서문시장 & 서문시장 야시장' 통째로는 코퍼스에 없다 — 토큰 '서문시장' 으로 잡아야
    // 인지도 하한(0.15)을 면한다. 정답이 적재돼 있는데 상위에 못 오던 주요 원인이었다.
    const decorated = '대구 서문시장 & 서문시장 야시장';
    expect(index.mentions(decorated)).toBeGreaterThan(0);
    expect(index.score(decorated)).toBeGreaterThan(NEUTRAL_POPULARITY);
  });

  it('기관 수식어 폴백은 그대로 동작한다', () => {
    expect(index.mentions('국립대구박물관')).toBe(1);
  });

  it('언급 0 인 마이너 장소는 중립이 아니라 하한이다 (셀 수 있는 이름이므로)', () => {
    expect(index.score('무명한옥카페')).toBeLessThan(NEUTRAL_POPULARITY);
  });
});
