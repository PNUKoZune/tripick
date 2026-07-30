/// <reference types="jest" />

import { PlaceEmbeddingRepository } from '../../../src/planner/retrieval/place-embedding.repository';

interface Call {
  sql: string;
  params: unknown[];
}

describe('PlaceEmbeddingRepository.deleteRegion', () => {
  it('시도 라벨은 정본 코드로도 지워 시군구 타깃 라벨이 남지 않는다', async () => {
    const { repo, calls } = build();

    await repo.deleteRegion('강원특별자치도');

    const { sql, params } = calls[0]!;
    expect(sql).toContain('region_code = ANY');
    // 라벨 어간 '강원%' 은 '속초'·'강릉' 을 못 잡으므로 코드 조건이 그 몫을 맡는다.
    expect(params[2]).toBe('강원%');
    expect(params[3]).toEqual(['강원']);
  });

  it("slug 폴백값 'default' 를 삭제 키로 쓰지 않는다", async () => {
    const { repo, calls } = build();

    await repo.deleteRegion('강원특별자치도');

    // 4개 슬러그 밖 지역은 normalizeDestinationRegion 이 'default' 를 주므로 그대로 쓰면
    // 이 reseed 가 다른 지역의 'default' 라벨 행까지 지운다.
    expect(calls[0]!.params).not.toContain('default');
    expect(calls[0]!.params[1]).toBeNull();
  });

  it('seed 슬러그 라벨이 있는 지역은 그 슬러그도 함께 지운다', async () => {
    const { repo, calls } = build();

    await repo.deleteRegion('서울특별시');

    expect(calls[0]!.params[1]).toBe('seoul');
    expect(calls[0]!.params[3]).toEqual(['서울']);
  });

  it('시군구 단위 타깃은 라벨만 지운다 (상위 시도 전체를 비우지 않는다)', async () => {
    const { repo, calls } = build();

    await repo.deleteRegion('속초');

    expect(calls[0]!.params[0]).toBe('속초');
    expect(calls[0]!.params[2]).toBe('속초%');
    expect(calls[0]!.params[3]).toBeNull();
  });

  it('통합 라벨은 포괄하는 시도 코드를 모두 지운다', async () => {
    const { repo, calls } = build();

    await repo.deleteRegion('전남광주통합특별시');

    expect(calls[0]!.params[3]).toEqual(['광주', '전남']);
  });
});

describe('PlaceEmbeddingRepository.countRegionCandidates', () => {
  it('시도 목적지는 region_code 로 센다 (라벨 표기와 무관)', async () => {
    const { repo, calls } = build([{ count: '660' }]);

    await expect(repo.countRegionCandidates('서울특별시')).resolves.toBe(660);
    expect(calls[0]!.sql).toContain('region_code = $1');
    expect(calls[0]!.params).toEqual(['서울']);
  });

  it('시도로 안 잡히는 목적지는 sigungu_code 로 센다', async () => {
    const { repo, calls } = build([{ count: '33' }]);

    await expect(repo.countRegionCandidates('경주')).resolves.toBe(33);
    expect(calls[0]!.sql).toContain('sigungu_code = $1');
    expect(calls[0]!.params).toEqual(['경주']);
  });

  it('지역 코드가 안 잡히는 목적지는 조회 없이 0', async () => {
    const { repo, calls } = build();

    // 어간이 남지 않는 입력. 국내가 아닌 자유 입력('스위스')은 시군구 코드로는 잡히지만
    // 그 코드로 적재된 행이 없어 0 이 되므로, 게이트 결과는 어느 쪽이든 같다.
    await expect(repo.countRegionCandidates('   ')).resolves.toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('PlaceEmbeddingRepository.findSamePlace', () => {
  it('이름은 정규화해 비교하고 반경 안의 가장 가까운 행을 준다', async () => {
    const { repo, calls } = build([{ id: 'row-1', opening_hours: '09:00-18:00' }]);

    await expect(repo.findSamePlace('광주 양동시장', { lat: 35.15, lng: 126.9 })).resolves.toEqual({
      id: 'row-1',
      openingHours: '09:00-18:00',
    });
    // 공백 제거·소문자는 적재 dedupe·정리 CLI 와 같은 규칙(normalizeCatalogName)이어야 한다.
    expect(calls[0]!.params).toEqual(['광주양동시장', 35.15, 126.9, 250]);
    expect(calls[0]!.sql).toContain('ORDER BY distance_m');
  });

  it('반경 안에 없으면 null', async () => {
    const { repo } = build([]);

    await expect(repo.findSamePlace('불국사', { lat: 35.79, lng: 129.33 })).resolves.toBeNull();
  });
});

describe('PlaceEmbeddingRepository.seedRegion', () => {
  it('폴백 시드는 DB 에 넣지 않는다 (모든 지역 검색에 남는 unlabeled 행이 된다)', async () => {
    const { repo, calls } = build();
    const embed = jest.fn().mockResolvedValue([1, 0]);

    await expect(repo.seedRegion('강릉', embed)).resolves.toBe(0);
    expect(embed).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('전용 seed 카탈로그가 있는 지역은 그대로 시딩한다', async () => {
    const { repo, calls } = build();
    const embed = jest.fn().mockResolvedValue([1, 0]);

    await expect(repo.seedRegion('서울', embed)).resolves.toBe(6);
    expect(calls.filter((call) => call.sql.includes('INSERT INTO place_embeddings'))).toHaveLength(6);
  });
});

function build(rows: unknown[] = []): { repo: PlaceEmbeddingRepository; calls: Call[] } {
  const calls: Call[] = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      // findProvenance(SELECT id, text_hash …) 는 '기존 행 없음' 으로 둬 seed 가 삽입까지 가게 한다.
      return sql.includes('text_hash, embedding_model') ? [] : rows;
    }),
  };
  return { repo: new PlaceEmbeddingRepository(dataSource as never), calls };
}
