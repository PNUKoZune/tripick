/// <reference types="jest" />

import axios from 'axios';
import {
  mentionSpecificity,
  NaverPopularityIndex,
  NaverSearchService,
  NEUTRAL_POPULARITY,
  RegionSpecificPopularityIndex,
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

  it('앞머리 토큰으로 남의 인지도를 물려받지 않는다', () => {
    const corpus = Array.from({ length: 20 }, () => '전주수목원 ').join('');
    const index = new NaverPopularityIndex(corpus, 10);

    // 모시설은 제 언급을 그대로 받는다.
    expect(index.mentions('전주수목원')).toBe(20);
    // 부속 시설은 앞머리(모시설)를 매칭 키로 못 쓴다 — 제 이름은 코퍼스에 없다.
    expect(index.mentions('전주수목원 무궁화화원1')).toBe(0);
    expect(index.mentions('한옥마을 선비문화관')).toBe(0);
  });

  it('장식 구분자가 있는 등록명은 앞머리가 곧 정체성이라 예외다', () => {
    const corpus = Array.from({ length: 12 }, () => '롯데월드타워 ').join('');
    const index = new NaverPopularityIndex(corpus, 10);

    // '&' 로 이어 붙인 등록명 — 앞머리를 막으면 정답을 통째로 잃는다.
    expect(index.mentions('롯데월드타워&롯데월드몰')).toBe(12);
  });

  it('괄호 안 구분자를 뗀 이름으로도 센다 — 카탈로그의 동명이지 표기', () => {
    const corpus = Array.from({ length: 7 }, () => '사직공원 ').join('');
    const index = new NaverPopularityIndex(corpus, 10);

    // 블로그는 '사직공원(광주)' 라고 안 쓴다. 못 세면 실제 정답이 하한(0.15)을 맞는다.
    expect(index.mentions('사직공원(광주)')).toBe(7);
  });

  it('많이 언급된 장소끼리도 갈라야 한다 — 상위가 전부 1.00 이면 인지도가 순위를 못 만든다', () => {
    const many = Array.from({ length: 40 }, () => '해운대 ').join('');
    const some = Array.from({ length: 9 }, () => '광안리 ').join('');
    const dense = new NaverPopularityIndex(`${many}${some}`, 10);

    // 종전 기울기 0.18 은 8회에서 이미 1.00 이라 40회와 9회가 동점이 된다.
    const saturating = new NaverPopularityIndex(`${many}${some}`, 10, 0.18);
    expect(saturating.score('해운대')).toBe(saturating.score('광안리'));

    expect(dense.score('해운대')).toBeGreaterThan(dense.score('광안리'));
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
  const idx = new NaverPopularityIndex(
    '경주박물관 관람 후기, 경주박물관 주차. 시내 도서관 도서관 카페.',
    2,
  );

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
    // 전국 대조 코퍼스('국내 …' 검색)에는 없고 목적지 코퍼스에만 있는 이름이어야 가점이 남는다.
    mockedAxios.get.mockImplementation((_url: string, options?: any) =>
      Promise.resolve({
        data: String(options?.params?.query ?? '').includes('경주')
          ? { items: [{ title: '경주 <b>불국사</b> 후기', description: '불국사 최고' }] }
          : { items: [{ title: '국내 여행지 추천', description: '전국 명소 모음' }] },
      }),
    );
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
    mockedAxios.get.mockImplementation((url: string, options?: any) =>
      url.includes('/cafearticle')
        ? Promise.reject(new Error('cafe down'))
        : Promise.resolve({
            data: String(options?.params?.query ?? '').includes('경주')
              ? { items: [{ title: '경주 <b>불국사</b> 후기', description: '불국사 최고' }] }
              : { items: [{ title: '국내 여행지 추천', description: '전국 명소 모음' }] },
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

  it('같은 목적지의 동시 cache miss를 외부 요청 한 벌로 합친다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockedAxios.get.mockImplementation(async () => {
      await gate;
      return { data: { items: [{ title: '불국사', description: '추천' }] } } as never;
    });
    const service = new NaverSearchService(
      config({ NAVER_SEARCH_CLIENT_ID: 'id', NAVER_SEARCH_CLIENT_SECRET: 'secret' }),
    );

    const first = service.getPopularityIndex('경주');
    const second = service.getPopularityIndex('경주');
    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    // 지역 3검색어×2 endpoint + 전국 대조 3검색어×2 endpoint. 두 호출이 겹쳐도 12회뿐이다.
    expect(mockedAxios.get).toHaveBeenCalledTimes(12);
  });

  it('검색어 병렬 처리를 설정한 상한 안으로 제한한다', async () => {
    let active = 0;
    let peak = 0;
    mockedAxios.get.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { data: { items: [{ title: '장소', description: '추천' }] } } as never;
    });
    const service = new NaverSearchService(
      config({
        NAVER_SEARCH_CLIENT_ID: 'id',
        NAVER_SEARCH_CLIENT_SECRET: 'secret',
        NAVER_SEARCH_CONCURRENCY: '1',
      }),
    );

    await service.collectMentionCorpus(['첫 검색', '둘 검색', '셋 검색']);

    // 검색어는 한 번에 하나, 그 안의 blog+cafe 두 endpoint만 동시에 돈다.
    expect(peak).toBe(2);
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

/**
 * compact 매칭(공백 제거)은 '동궁과 월지'↔'동궁과월지' 를 흡수하려고 넣은 것인데,
 * 짧은 이름에선 공백을 건너뛰어 남의 문장을 자기 언급으로 만든다(광주 식당 '조금더').
 */
describe('NaverPopularityIndex 짧은 이름 공백 매칭', () => {
  const corpus =
    '광주 맛집 추천, 조금 더 걸으면 나오는 집. 조금 더 매콤한 맛. 무등산 등산 후 국밥. ' +
    '무등산 야경도 좋다. 동궁과 월지 야간개장.';
  const index = new NaverPopularityIndex(corpus, 5);

  it('3글자 이름이 공백을 건너뛴 매칭만 걸리면 판정 보류(중립)', () => {
    // '조금 더' 는 부사구다. 여기서 감점(0.15)까지 주면 띄어 쓴 실제 짧은 이름이 손해를 본다.
    expect(index.mentions('조금더')).toBe(0);
    expect(index.score('조금더')).toBe(NEUTRAL_POPULARITY);
  });

  it('3글자 명소는 붙여 쓰이므로 그대로 센다', () => {
    expect(index.mentions('무등산')).toBe(2);
    expect(index.score('무등산')).toBeGreaterThan(NEUTRAL_POPULARITY);
  });

  it('4글자 이상은 기존 compact 매칭을 유지한다 (띄어쓰기 흡수)', () => {
    expect(index.mentions('동궁과월지')).toBe(1);
  });
});

/**
 * 역방향 매칭의 대가 — 이름이 흔한 한국어 단어인 상호가 남의 언급을 가져간다.
 * 지역 코퍼스와 전국 대조 코퍼스의 언급률 비(지역 특이도)로 갈라낸다.
 */
describe('RegionSpecificPopularityIndex', () => {
  const region = new NaverPopularityIndex(
    '대구 맛집 추천 맛있게 먹은 집. 맛있게 잘 먹었어요. 맛있게 한 상 차림. 서문시장 야시장. 서문시장 먹거리.',
    10,
  );
  const control = new NaverPopularityIndex(
    '국내 맛집 추천 맛있게 먹는 법. 맛있게 즐기기. 맛있게 한 그릇 비우기.',
    10,
  );
  const index = new RegionSpecificPopularityIndex(region, control, 5);

  it('전국 코퍼스에서도 흔한 이름은 가점을 주지 않고 중립으로 둔다', () => {
    expect(region.score('맛있게')).toBeGreaterThan(NEUTRAL_POPULARITY); // 필터 없으면 가점
    expect(index.score('맛있게')).toBe(NEUTRAL_POPULARITY);
    expect(index.mentions('맛있게')).toBe(0);
  });

  it('그 지역에서만 쓰이는 이름은 원래 점수를 유지한다', () => {
    expect(index.score('서문시장')).toBe(region.score('서문시장'));
    expect(index.mentions('서문시장')).toBe(region.mentions('서문시장'));
  });

  it('언급 자체가 없는 마이너 장소는 기존대로 하한(감점)이다', () => {
    // 중립으로 올려 주면 '언급 없는 장소'와 '일반어 상호'가 구분되지 않는다.
    expect(index.score('무명한옥카페')).toBe(region.score('무명한옥카페'));
    expect(index.score('무명한옥카페')).toBeLessThan(NEUTRAL_POPULARITY);
  });
});

describe('mentionSpecificity', () => {
  const region = new NaverPopularityIndex('제주 성산일출봉 성산일출봉 성산일출봉 우진해장국', 10);
  const control = new NaverPopularityIndex('국내 여행지 추천 성산일출봉 포함', 10);

  it('대조 코퍼스에 없는 이름은 Infinity (그 지역 고유명)', () => {
    expect(mentionSpecificity('우진해장국', region, control)).toBe(Infinity);
  });

  it('양쪽에 있으면 언급률 비를 돌려준다', () => {
    expect(mentionSpecificity('성산일출봉', region, control)).toBeCloseTo(3);
  });

  it('지역 코퍼스에 없으면 0', () => {
    expect(mentionSpecificity('한라산', region, control)).toBe(0);
  });
});
