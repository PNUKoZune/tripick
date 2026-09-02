/// <reference types="jest" />

import { DestinationAnchorService } from '../../../src/planner/retrieval/destination-anchor.service';
import type { KakaoPlaceBrief } from '../../../src/planner/retrieval/kakao-local.service';

describe('DestinationAnchorService', () => {
  it('행정구역으로 안 잡히는 목적지를 좌표+지역 코드로 해석한다', async () => {
    const { service, searchBrief } = build({
      catalogCount: 0,
      docs: [brief('광안리해수욕장', '부산 수영구 광안동 192-20', 35.1532, 129.119, 'AT4')],
    });

    await expect(service.resolve('광안리')).resolves.toEqual({
      coordinates: { lat: 35.1532, lng: 129.119 },
      label: '광안리해수욕장',
      // 지역 코드는 지번 주소에서 뽑는다 — 반경으로 못 채웠을 때의 폴백 범위가 된다.
      region: { sido: '부산', sigungu: '수영' },
    });
    expect(searchBrief).toHaveBeenCalledWith('광안리', 5);
  });

  it('시도가 잡히는 목적지는 카카오를 부르지 않는다', async () => {
    const { service, searchBrief } = build({ catalogCount: 0, docs: [] });

    await expect(service.resolve('부산 해운대구')).resolves.toBeNull();
    expect(searchBrief).not.toHaveBeenCalled();
  });

  it('시군구 코드로 후보가 나오는 목적지도 기존 경로에 둔다', async () => {
    // '해운대'(61행)·'경주'(382행)처럼 이미 지역 단위로 잘 도는 목적지를 앵커로 갈아타면
    // 후보 풀이 통째로 바뀐다. 0건인 입력만 이 경로로 와야 한다.
    const { service, searchBrief } = build({ catalogCount: 61, docs: [] });

    await expect(service.resolve('해운대')).resolves.toBeNull();
    expect(searchBrief).not.toHaveBeenCalled();
  });

  it('이름이 목적지를 포함하지 않으면 앵커를 포기한다 (틀린 앵커 > 앵커 없음)', async () => {
    // 실측: '서면' 키워드 검색 1위가 순천시 서면의 자연휴양림이다. 그대로 쓰면 부산 서면
    // 여행이 전남 여행이 된다.
    const { service } = build({
      catalogCount: 0,
      docs: [
        brief(
          '순천자연휴양림',
          '전남광주통합특별시 순천시 서면 운평리 산 159',
          35.04,
          127.47,
          'AT4',
        ),
      ],
    });

    await expect(service.resolve('서면')).resolves.toBeNull();
  });

  it('주차장·숙박 같은 부속 시설은 앵커 후보에서 뺀다', async () => {
    const { service } = build({
      catalogCount: 0,
      docs: [
        brief('광안리해수욕장 공영주차장', '부산 수영구 광안동 198-3', 35.1516, 129.116, 'PK6'),
        brief('켄트호텔 광안리by켄싱턴', '부산 수영구 광안동 192-7', 35.1543, 129.1191, 'AD5'),
        brief('광안리해수욕장', '부산 수영구 광안동 192-20', 35.1532, 129.119, 'AT4'),
      ],
    });

    await expect(service.resolve('광안리')).resolves.toMatchObject({ label: '광안리해수욕장' });
  });

  it('지하철역은 앵커로 남긴다 (역세권 목적지가 이 기능의 원래 요청)', async () => {
    const { service } = build({
      catalogCount: 0,
      docs: [brief('서면역 부산1호선', '부산 부산진구 부전동 573-1', 35.1579, 129.0593, 'SW8')],
    });

    await expect(service.resolve('서면역')).resolves.toMatchObject({
      label: '서면역 부산1호선',
      region: { sido: '부산', sigungu: '부산진' },
    });
  });

  it('해석 실패도 캐시해 같은 목적지를 다시 조회하지 않는다', async () => {
    // 일자별 지역까지 겹치면 한 여행에서 같은 목적지가 여러 번 들어온다.
    const { service, searchBrief } = build({ catalogCount: 0, docs: [] });

    await service.resolve('서면');
    await service.resolve('서면');

    expect(searchBrief).toHaveBeenCalledTimes(1);
  });

  it('같은 목적지의 동시 cache miss도 한 번만 해석한다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, searchBrief } = build({
      catalogCount: 0,
      docs: [brief('광안리해수욕장', '부산 수영구 광안동 192-20', 35.1532, 129.119, 'AT4')],
    });
    searchBrief.mockImplementation(async () => {
      await gate;
      return [brief('광안리해수욕장', '부산 수영구 광안동 192-20', 35.1532, 129.119, 'AT4')];
    });

    const first = service.resolve('광안리');
    const second = service.resolve('광안리');
    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(searchBrief).toHaveBeenCalledTimes(1);
  });

  it('킬 스위치를 내리면 카카오를 부르지 않고 기존 경로로 둔다', async () => {
    const { service, searchBrief } = build({
      catalogCount: 0,
      docs: [brief('광안리해수욕장', '부산 수영구 광안동 192-20', 35.1532, 129.119, 'AT4')],
      env: { DESTINATION_ANCHOR_ENABLED: 'false' },
    });

    await expect(service.resolve('광안리')).resolves.toBeNull();
    expect(searchBrief).not.toHaveBeenCalled();
  });
});

function brief(
  name: string,
  address: string,
  lat: number,
  lng: number,
  categoryGroupCode: string | null,
): KakaoPlaceBrief {
  return { name, address, coordinates: { lat, lng }, categoryGroupCode };
}

function build(options: {
  catalogCount: number;
  docs: KakaoPlaceBrief[];
  env?: Record<string, string>;
}) {
  const searchBrief = jest.fn().mockResolvedValue(options.docs);
  const config = {
    get<T = string>(key: string, fallback?: T): T {
      return ((options.env ?? {})[key] ?? fallback) as T;
    },
  };
  const service = new DestinationAnchorService(
    config as never,
    { searchBrief } as never,
    { countRegionCandidates: jest.fn().mockResolvedValue(options.catalogCount) } as never,
  );
  return { service, searchBrief };
}
