/// <reference types="jest" />

jest.mock('axios');

import axios from 'axios';
import { KakaoLocalService } from '../../../src/planner/retrieval/kakao-local.service';
import type { RetrievalContext } from '../../../src/planner/retrieval/types';

const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * 제과·베이커리는 카카오가 FD6(음식점 > 간식)에 두는데 KTO 는 같은 곳을 FD030100(제과)으로 줘
 * 카페로 적재된다. 한쪽만 고치면 같은 빵집이 소스마다 다른 카테고리가 되고, 근접 중복 병합이
 * 카테고리 일치를 요구하므로 두 행이 한 날에 나란히 배치된다.
 */
describe('KakaoLocalService 카테고리 판정', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  it('제과·베이커리는 group code(FD6)보다 앞서 cafe 로 가른다', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { documents: [doc('성심당', 'FD6', '음식점 > 간식 > 제과,베이커리')] },
    });

    const [place] = await build().search(context(), 5);

    expect(place).toMatchObject({ name: '성심당', category: 'cafe' });
  });

  it('일반 음식점은 그대로 restaurant', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { documents: [doc('할매국밥', 'FD6', '음식점 > 한식 > 국밥')] },
    });

    const [place] = await build().search(context(), 5);

    expect(place).toMatchObject({ category: 'restaurant' });
  });

  it('카페 group code(CE7)는 그대로 cafe', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { documents: [doc('그리너리', 'CE7', '음식점 > 카페')] },
    });

    const [place] = await build().search(context(), 5);

    expect(place).toMatchObject({ category: 'cafe' });
  });
});

function doc(name: string, groupCode: string, categoryName: string) {
  return {
    id: `k-${name}`,
    place_name: name,
    category_name: categoryName,
    category_group_code: groupCode,
    address_name: '대전 중구 은행동 1',
    road_address_name: '대전 중구 대종로480번길 15',
    x: '127.4258',
    y: '36.3277',
  };
}

function context(): RetrievalContext {
  return { userId: 'u-1', destination: '대전' };
}

function build(): KakaoLocalService {
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key === 'KAKAO_LOCAL_API_KEY' || key === 'KAKAO_REST_API_KEY' ? 'test-key' : fallback,
    ),
  };
  return new KakaoLocalService(config as never);
}
