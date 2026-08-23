/// <reference types="jest" />

jest.mock('axios');

import axios from 'axios';
import {
  KtoCallBudget,
  TourApiService,
  classifyTourFood,
} from '../../../src/planner/retrieval/tour-api.service';

const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * append 커서가 실행 옵션(`--max`)에 묶여 있던 회귀를 막는다.
 * 커서 단위가 페이지면 같은 숫자가 배치 크기에 따라 다른 구간을 뜻한다.
 */
describe('TourApiService.fetchByArea 오프셋 커서', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  it('오프셋을 배치 경계로 내림 정렬해 pageNo 로 바꾼다', async () => {
    mockedAxios.get.mockResolvedValue({ data: page(100) });
    const service = build();

    const result = await service.fetchByArea('51', '강원특별자치도', 100, 250);

    expect(paramsOf(0)).toMatchObject({ pageNo: 3, numOfRows: 100 });
    // page 3 = 200행부터. 100행을 읽었으니 다음은 300.
    expect(result.nextOffset).toBe(300);
  });

  it('배치 크기가 달라도 같은 오프셋에서 이어 읽는다', async () => {
    mockedAxios.get.mockResolvedValue({ data: page(50) });
    const service = build();

    // 같은 커서(200)를 --max=50 으로 읽는다 → 200행부터(page 5). 페이지 커서였다면
    // 같은 숫자가 --max=100 에서 200행, --max=50 에서 100행으로 어긋났다.
    const result = await service.fetchByArea('51', '강원특별자치도', 50, 200);

    expect(paramsOf(0)).toMatchObject({ pageNo: 5, numOfRows: 50 });
    expect(result.nextOffset).toBe(250);
  });

  it('커서가 없으면 첫 페이지부터', async () => {
    mockedAxios.get.mockResolvedValue({ data: page(100) });
    const service = build();

    await service.fetchByArea('51', '강원특별자치도', 100);

    expect(paramsOf(0)).toMatchObject({ pageNo: 1 });
  });

  it('마지막 페이지에 닿으면 커서를 0 으로 되돌린다', async () => {
    mockedAxios.get.mockResolvedValue({ data: page(30) }); // batchSize 100 미만 → 끝
    const service = build();

    const result = await service.fetchByArea('51', '강원특별자치도', 100, 400);

    expect(result.nextOffset).toBe(0);
    expect(result.places).toHaveLength(30);
  });
});

function paramsOf(call: number): Record<string, unknown> {
  return (mockedAxios.get.mock.calls[call]![1] as { params: Record<string, unknown> }).params;
}

function page(count: number) {
  return {
    response: {
      body: {
        items: {
          item: Array.from({ length: count }, (_, index) => ({
            contentid: `c-${index}`,
            contenttypeid: '12',
            title: `강원 관광지 ${index}`,
            addr1: '강원특별자치도 속초시 영금정로 45',
            mapx: '128.5989',
            mapy: '38.2115',
          })),
        },
      },
    },
  };
}

function build(): TourApiService {
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'KTO_API_KEY') return 'test-key';
      // 영업시간 조회는 이 테스트의 관심사가 아니고 호출 수만 늘린다.
      if (key === 'KTO_FETCH_OPENING_HOURS') return 'false';
      return fallback;
    }),
  };
  return new TourApiService(config as never);
}

/**
 * KTO 음식(contentTypeId 39)은 카페·찻집까지 한 덩어리라 예전엔 전부 restaurant 로 적재됐다.
 * 카탈로그의 카페가 카카오 소스에만 있었고(일정의 카페 자리가 만성적으로 빔), 같은 카페가
 * 두 소스에 다른 카테고리로 남아 근접 중복 병합도 빠져나갔다.
 */
describe('classifyTourFood 음식 중분류', () => {
  it('카페/찻집(FD05)은 cafe 로 가른다', () => {
    expect(classifyTourFood({ lclsSystm2: 'FD05', lclsSystm3: 'FD050100' })).toEqual({
      category: 'cafe',
      categoryDetail: '카페',
    });
  });

  it('제과(FD030100)는 간이음식이지만 cafe 로 — 끼니보다 오후 휴식 자리에 맞다', () => {
    expect(classifyTourFood({ lclsSystm2: 'FD03', lclsSystm3: 'FD030100' })).toEqual({
      category: 'cafe',
      categoryDetail: '제과',
    });
  });

  it.each([
    ['FD01', 'FD010100'], // 한식
    ['FD02', 'FD020200'], // 외국식
    ['FD03', 'FD030400'], // 간이음식 — 김밥·분식
    ['FD04', 'FD040100'], // 주점
  ])('%s 는 restaurant 로 남는다', (mid, leaf) => {
    expect(classifyTourFood({ lclsSystm2: mid, lclsSystm3: leaf })).toEqual({
      category: 'restaurant',
      categoryDetail: '음식점',
    });
  });

  /**
   * restaurant 로 남는 행의 라벨을 '음식점' 그대로 두는 건 의도다 — 라벨이 임베딩 텍스트에
   * 들어가므로 바꾸면 해시가 달라져 멀쩡한 12,000여 행이 통째로 재임베딩된다.
   */
  it('분류체계가 비면 기존 동작(restaurant/음식점)으로 떨어진다', () => {
    expect(classifyTourFood({})).toEqual({ category: 'restaurant', categoryDetail: '음식점' });
  });
});

describe('TourApiService 음식 분류 적재', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  it('FD05 행은 cafe 로 적재된다', async () => {
    mockedAxios.get.mockResolvedValue({ data: foodPage([{ id: 'f-1', mid: 'FD05', leaf: 'FD050100' }]) });

    const { places } = await build().fetchByArea('26', '부산광역시', 100);

    expect(places[0]).toMatchObject({ category: 'cafe', categoryDetail: '카페' });
  });

  it('같은 페이지의 한식 행은 restaurant 로 남는다', async () => {
    mockedAxios.get.mockResolvedValue({
      data: foodPage([
        { id: 'f-1', mid: 'FD05', leaf: 'FD050200' },
        { id: 'f-2', mid: 'FD01', leaf: 'FD010100' },
      ]),
    });

    const { places } = await build().fetchByArea('26', '부산광역시', 100);

    expect(places.map((p) => p.category)).toEqual(['cafe', 'restaurant']);
  });
});

describe('TourApiService.fetchFoodClassContentIds', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  it('음식 분류 필터를 그대로 실어 보낸다', async () => {
    mockedAxios.get.mockResolvedValue({ data: foodPage([{ id: 'f-1', mid: 'FD05', leaf: 'FD050100' }]) });

    await build().fetchFoodClassContentIds('26', { lclsSystm2: 'FD05' });

    expect(paramsOf(0)).toMatchObject({ contentTypeId: '39', lclsSystm2: 'FD05', lDongRegnCd: '26' });
    expect(paramsOf(0)).not.toHaveProperty('lclsSystm3');
  });

  it('가득 찬 페이지면 다음 페이지까지 이어 읽고 중복 id 를 접는다', async () => {
    const full = foodPage(
      Array.from({ length: 100 }, (_, i) => ({ id: `f-${i}`, mid: 'FD05', leaf: 'FD050100' })),
    );
    mockedAxios.get
      .mockResolvedValueOnce({ data: full })
      // 2페이지가 1페이지와 겹쳐 와도(정렬 흔들림) id 집합은 100건이어야 한다.
      .mockResolvedValueOnce({ data: foodPage([{ id: 'f-0', mid: 'FD05', leaf: 'FD050100' }]) });

    const ids = await build().fetchFoodClassContentIds('26', { lclsSystm2: 'FD05' });

    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(ids).toHaveLength(100);
  });

  it('예산이 소진되면 호출을 멈춘다', async () => {
    mockedAxios.get.mockResolvedValue({ data: foodPage([{ id: 'f-1', mid: 'FD05', leaf: 'FD050100' }]) });
    const budget = new KtoCallBudget(0);

    await expect(
      build().fetchFoodClassContentIds('26', { lclsSystm2: 'FD05' }, budget),
    ).rejects.toThrow();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

function foodPage(rows: Array<{ id: string; mid: string; leaf: string }>) {
  return {
    response: {
      body: {
        items: {
          item: rows.map((row) => ({
            contentid: row.id,
            contenttypeid: '39',
            title: `부산 음식 ${row.id}`,
            addr1: '부산광역시 해운대구 구남로 1',
            mapx: '129.1603',
            mapy: '35.1587',
            lclsSystm1: 'FD',
            lclsSystm2: row.mid,
            lclsSystm3: row.leaf,
          })),
        },
      },
    },
  };
}
