/// <reference types="jest" />

import { PreferenceEmbeddingRepository } from '../../src/preferences/preference-embedding.repository';

describe('PreferenceEmbeddingRepository provenance', () => {
  it('모델과 출처를 벡터와 원자적으로 upsert 한다', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'emb-1' }]);
    const repository = new PreferenceEmbeddingRepository({ query } as never);

    await expect(
      repository.upsertUserEmbedding('u1', [0.1, 0.2], 'taste:cafe', {
        modelId: 'bge-m3-ko',
        source: 'remote',
      }),
    ).resolves.toBe('emb-1');

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain('embedding_model');
    expect(sql).toContain('embedding_source');
    expect(params).toEqual(['u1', '[0.1,0.2]', 'taste:cafe', 'bge-m3-ko', 'remote']);
  });

  it('현재 원격 모델과 일치하는 벡터만 조회한다', async () => {
    const query = jest.fn().mockResolvedValue([{ embedding: '[0.1,0.2]' }]);
    const repository = new PreferenceEmbeddingRepository({ query } as never);

    await expect(repository.findVectorByUser('u1', 'bge-m3-ko')).resolves.toEqual([0.1, 0.2]);

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("embedding_source = 'remote'");
    expect(sql).toContain('embedding_model = $2');
    expect(params).toEqual(['u1', 'bge-m3-ko']);
  });
});

describe('PreferenceEmbeddingRepository.findVectorsByUsers', () => {
  it('loads all member vectors in one parameterized query and parses pgvector text', async () => {
    const query = jest.fn().mockResolvedValue([
      { user_id: 'u1', embedding: '[1,0]' },
      { user_id: 'u2', embedding: '[0.25,0.75]' },
      { user_id: 'empty', embedding: null },
    ]);
    const repo = new PreferenceEmbeddingRepository({ query } as never);

    const vectors = await repo.findVectorsByUsers(['u1', 'u1', 'u2'], 'bge-m3-ko');

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toContain('user_id = ANY($1::uuid[])');
    expect(query.mock.calls[0]![0]).toContain("embedding_source = 'remote'");
    expect(query.mock.calls[0]![0]).toContain('embedding_model = $2');
    expect(query.mock.calls[0]![1]).toEqual([['u1', 'u2'], 'bge-m3-ko']);
    expect(vectors).toEqual(
      new Map([
        ['u1', [1, 0]],
        ['u2', [0.25, 0.75]],
      ]),
    );
  });

  it('skips the database for an empty member list', async () => {
    const query = jest.fn();
    const repo = new PreferenceEmbeddingRepository({ query } as never);

    await expect(repo.findVectorsByUsers([], 'bge-m3-ko')).resolves.toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });
});
