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
