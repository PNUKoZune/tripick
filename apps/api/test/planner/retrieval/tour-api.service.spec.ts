/// <reference types="jest" />

jest.mock('axios');

import axios from 'axios';
import { TourApiService } from '../../../src/planner/retrieval/tour-api.service';

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
