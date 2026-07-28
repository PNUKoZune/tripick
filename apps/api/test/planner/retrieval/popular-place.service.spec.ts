/// <reference types="jest" />

import { PopularPlaceService } from '../../../src/planner/retrieval/popular-place.service';
import { NaverPopularityIndex } from '../../../src/planner/retrieval/naver-search.service';
import type { RawPlaceCandidate } from '../../../src/planner/retrieval/types';

function config(values: Record<string, string> = {}) {
  return { get: (key: string, fallback?: unknown) => values[key] ?? fallback } as any;
}

/** 서울 명소 코퍼스. '남산서울타워'는 여러 번, '경주여행사'는 한 번도 안 나온다. */
const ATTRACTION_CORPUS =
  '서울 여행지 추천 남산서울타워 야경. 남산서울타워는 필수. 남산서울타워 케이블카. ' +
  '서울 가볼만한 곳 남산서울타워 롯데월드타워. 서울 여행 다녀왔어요.';
const RESTAURANT_CORPUS = '서울 맛집 추천 을지면옥 냉면. 을지면옥 웨이팅. 을지면옥 다시 방문.';

function doc(over: Partial<RawPlaceCandidate>): RawPlaceCandidate {
  return {
    id: 'kakao-1',
    kakaoPlaceId: '1',
    name: '남산서울타워',
    category: 'attraction',
    address: '서울 용산구 남산공원길 105',
    coordinates: { lat: 37.55, lng: 126.98 },
    source: 'kakao',
    tags: [],
    ...over,
  } as RawPlaceCandidate;
}

/** 축별 코퍼스를 순서대로 돌려주는 네이버 스텁 (명소 → 맛집). */
function naverStub(texts: string[] = [ATTRACTION_CORPUS, RESTAURANT_CORPUS]) {
  const queue = [...texts];
  return {
    hasCredentials: () => true,
    collectMentionCorpus: jest.fn(async () => {
      const text = queue.shift();
      if (text === undefined) return null;
      return { text, docCount: 10, index: new NaverPopularityIndex(text, 10) };
    }),
  } as any;
}

function kakaoStub(docsByKeyword: (keyword: string) => RawPlaceCandidate[]) {
  return {
    searchByText: jest.fn(async (keyword: string) => docsByKeyword(keyword)),
  } as any;
}

describe('PopularPlaceService', () => {
  it('네이버에서 뽑은 이름을 카카오로 정규화해 적재 후보로 만든다', async () => {
    const kakao = kakaoStub((keyword) =>
      keyword.includes('남산서울타워') ? [doc({})] : [],
    );
    const service = new PopularPlaceService(config(), naverStub(), kakao);

    const places = await service.collect('서울', 10);

    expect(places).toContainEqual(
      expect.objectContaining({
        name: '남산서울타워',
        region: '서울',
        sigungu: '용산구',
        kakaoPlaceId: '1',
        source: 'popular',
      }),
    );
  });

  it('정본명이 코퍼스에 없으면 탈락한다 (관문 ②: 여행 → 경주여행사)', async () => {
    // 카카오는 어떤 후보를 물어도 코퍼스에 없는 이름을 돌려준다.
    const kakao = kakaoStub(() => [doc({ name: '서울여행사', kakaoPlaceId: '9' })]);
    const service = new PopularPlaceService(config(), naverStub(), kakao);

    expect(await service.collect('서울', 10)).toHaveLength(0);
  });

  it('다른 시도의 동명 장소는 주소 기준으로 탈락한다', async () => {
    const kakao = kakaoStub(() => [
      doc({ address: '부산 해운대구 어딘가 1', kakaoPlaceId: '7' }),
    ]);
    const service = new PopularPlaceService(config(), naverStub(), kakao);

    expect(await service.collect('서울', 10)).toHaveLength(0);
  });

  it('축과 다른 카테고리는 탈락한다 (명소 축에 음식점)', async () => {
    const kakao = kakaoStub(() => [doc({ category: 'restaurant' })]);
    // 맛집 축 코퍼스는 비워 명소 축만 보게 한다.
    const service = new PopularPlaceService(config(), naverStub([ATTRACTION_CORPUS]), kakao);

    expect(await service.collect('서울', 10)).toHaveLength(0);
  });

  it('맛집 축은 음식점·카페를 받는다', async () => {
    const kakao = kakaoStub((keyword) =>
      keyword.includes('을지면옥')
        ? [doc({ name: '을지면옥', category: 'restaurant', kakaoPlaceId: '3', address: '서울 중구 창경궁로 62-5' })]
        : [],
    );
    const service = new PopularPlaceService(config(), naverStub(['', RESTAURANT_CORPUS]), kakao);

    const places = await service.collect('서울', 10);
    expect(places.map((p) => p.name)).toEqual(['을지면옥']);
  });

  it('한 축의 코퍼스가 비어도 나머지 축은 계속 수집한다', async () => {
    const kakao = kakaoStub((keyword) =>
      keyword.includes('을지면옥')
        ? [doc({ name: '을지면옥', category: 'restaurant', kakaoPlaceId: '3', address: '서울 중구 창경궁로 62-5' })]
        : [],
    );
    // 명소 축은 null(수집 실패), 맛집 축만 성공.
    const naver = {
      hasCredentials: () => true,
      collectMentionCorpus: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          text: RESTAURANT_CORPUS,
          docCount: 10,
          index: new NaverPopularityIndex(RESTAURANT_CORPUS, 10),
        }),
    } as any;
    const service = new PopularPlaceService(config(), naver, kakao);

    expect((await service.collect('서울', 10)).map((p) => p.name)).toEqual(['을지면옥']);
  });

  it('축 예산을 넘으면 남은 후보는 카카오에 묻지 않는다', async () => {
    const kakao = kakaoStub((keyword) =>
      keyword.includes('남산서울타워') ? [doc({})] : [],
    );
    // budget 1 → 명소 축 예산 max(1, round(0.6)) = 1 건에서 멈춘다.
    const service = new PopularPlaceService(config(), naverStub([ATTRACTION_CORPUS]), kakao);

    const places = await service.collect('서울', 1);
    expect(places).toHaveLength(1);
    // 첫 후보가 바로 통과했으므로 카카오 조회는 1회뿐이어야 한다.
    expect(kakao.searchByText).toHaveBeenCalledTimes(1);
  });

  it('통합 시도 라벨은 두 시도를 모두 인정한다 (광주가 통째로 탈락하면 안 된다)', async () => {
    // 카카오 주소도 '전남광주통합특별시' 를 쓰므로, 대상 시도를 하나로 잡으면
    // 광주(자치구) 또는 전남(시·군) 한쪽이 전부 'region' 탈락한다.
    const corpus = '전남광주 여행지 추천 국립아시아문화전당. 국립아시아문화전당 야경. 오동도 동백. 오동도 산책.';
    const kakao = kakaoStub((keyword) => {
      if (keyword.includes('국립아시아문화전당')) {
        return [
          doc({
            name: '국립아시아문화전당',
            kakaoPlaceId: 'g1',
            address: '전남광주통합특별시 동구 문화전당로 38',
          }),
        ];
      }
      if (keyword.includes('오동도')) {
        return [
          doc({
            name: '오동도',
            kakaoPlaceId: 'j1',
            address: '전남광주통합특별시 여수시 오동도로 222',
          }),
        ];
      }
      return [];
    });
    const service = new PopularPlaceService(config(), naverStub([corpus]), kakao);

    const places = await service.collect('전남광주통합특별시', 20);
    expect(places.map((p) => p.name).sort()).toEqual(['국립아시아문화전당', '오동도']);
  });

  it('네이버 키가 없으면 isAvailable 이 false 다', () => {
    const naver = { hasCredentials: () => false } as any;
    expect(new PopularPlaceService(config(), naver, kakaoStub(() => [])).isAvailable).toBe(false);
  });
});
