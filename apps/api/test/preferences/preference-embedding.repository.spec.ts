/// <reference types="jest" />

import { PreferenceEmbeddingRepository } from '../../src/preferences/preference-embedding.repository';

describe('PreferenceEmbeddingRepository.findVectorsByUsers', () => {
  it('loads all member vectors in one parameterized query and parses pgvector text', async () => {
    const query = jest.fn().mockResolvedValue([
      { user_id: 'u1', embedding: '[1,0]' },
      { user_id: 'u2', embedding: '[0.25,0.75]' },
      { user_id: 'empty', embedding: null },
    ]);
    const repo = new PreferenceEmbeddingRepository({ query } as never);

    const vectors = await repo.findVectorsByUsers(['u1', 'u1', 'u2']);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toContain('user_id = ANY($1::uuid[])');
    expect(query.mock.calls[0]![1]).toEqual([['u1', 'u2']]);
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

    await expect(repo.findVectorsByUsers([])).resolves.toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });
});
