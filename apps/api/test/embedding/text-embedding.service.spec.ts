/// <reference types="jest" />

import axios from 'axios';
import type { ConfigService } from '@nestjs/config';
import { TextEmbeddingService } from '../../src/embedding/text-embedding.service';

jest.mock('axios');
const mockedPost = axios.post as jest.Mock;

function makeService(): TextEmbeddingService {
  const config = { get: (_key: string, def?: unknown) => def } as unknown as ConfigService;
  return new TextEmbeddingService(config);
}

describe('TextEmbeddingService.embedWithSource', () => {
  afterEach(() => jest.resetAllMocks());

  it('reports source=remote when the embedding server responds', async () => {
    mockedPost.mockResolvedValue({ data: { data: [{ embedding: [0.1, 0.2, 0.3] }] } });
    const result = await makeService().embedWithSource('테스트');
    expect(result.source).toBe('remote');
    expect(result.vector).toHaveLength(1536); // normalizeDimensions 패딩
  });

  it('falls back to source=hash when the embedding server is unavailable', async () => {
    mockedPost.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await makeService().embedWithSource('테스트');
    expect(result.source).toBe('hash');
    expect(result.vector).toHaveLength(1536);
  });

  it('embed() still returns just the vector', async () => {
    mockedPost.mockRejectedValue(new Error('down'));
    const vector = await makeService().embed('테스트');
    expect(Array.isArray(vector)).toBe(true);
    expect(vector).toHaveLength(1536);
  });
});
