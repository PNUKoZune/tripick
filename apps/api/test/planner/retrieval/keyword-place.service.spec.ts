/// <reference types="jest" />

import { KeywordPlaceService } from '../../../src/planner/retrieval/keyword-place.service';
import type { RawPlaceCandidate } from '../../../src/planner/retrieval/types';

function doc(over: Partial<RawPlaceCandidate>): RawPlaceCandidate {
  return {
    id: 'kakao-1',
    kakaoPlaceId: '1',
    name: '전리단길',
    category: 'attraction',
    address: '부산 부산진구 전포동 665-15',
    coordinates: { lat: 35.158, lng: 129.064 },
    source: 'kakao',
    tags: [],
    ...over,
  } as RawPlaceCandidate;
}

function build(searchByText: jest.Mock) {
  return new KeywordPlaceService({ searchByText } as never);
}

describe('KeywordPlaceService', () => {
  it('키워드를 카카오 정본으로 바꿔 적재 후보를 만든다', async () => {
    const search = jest.fn().mockResolvedValue([doc({})]);

    const places = await build(search).collect('부산', ['전리단길']);

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      name: '전리단길',
      region: '부산',
      sigungu: '부산진구',
      source: 'keyword',
    });
  });

  it('목적지와 다른 시도의 동명 장소는 버린다 — 카카오는 지역을 붙여도 섞어 준다', async () => {
    const search = jest.fn().mockResolvedValue([
      doc({ name: '사직공원', address: '서울 종로구 사직동', kakaoPlaceId: '9' }),
    ]);

    const places = await build(search).collect('광주', ['사직공원']);

    expect(places).toEqual([]);
  });

  it('타지역 문서를 건너뛰고 목적지 안의 다음 문서를 고른다', async () => {
    const search = jest.fn().mockResolvedValue([
      doc({ name: '사직공원', address: '서울 종로구 사직동', kakaoPlaceId: '9' }),
      doc({ name: '사직공원', address: '광주 남구 사직길 49', kakaoPlaceId: '10' }),
    ]);

    const places = await build(search).collect('광주', ['사직공원']);

    expect(places).toHaveLength(1);
    expect(places[0]!.address).toContain('광주');
  });

  it('운영자가 지정해도 적격 게이트는 그대로 — 프랜차이즈 지점은 안 들어온다', async () => {
    const search = jest.fn().mockResolvedValue([
      doc({ name: '스타벅스 부산송정비치점', category: 'cafe', kakaoPlaceId: '11' }),
    ]);

    const places = await build(search).collect('부산', ['스타벅스']);

    expect(places).toEqual([]);
  });

  it('같은 장소를 가리키는 키워드가 여럿이면 한 번만 담는다', async () => {
    const search = jest.fn().mockResolvedValue([doc({})]);

    const places = await build(search).collect('부산', ['전리단길', '전포 전리단길']);

    expect(places).toHaveLength(1);
  });
});
