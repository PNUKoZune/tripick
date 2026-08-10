/// <reference types="jest" />

import axios from 'axios';
import type { ConfigService } from '@nestjs/config';
import { TextEmbeddingService } from '../../src/embedding/text-embedding.service';

jest.mock('axios');
const mockedPost = axios.post as jest.Mock;

function makeService(overrides: Record<string, string> = {}): TextEmbeddingService {
  const config = {
    get: (key: string, def?: unknown) => (key in overrides ? overrides[key] : def),
  } as unknown as ConfigService;
  return new TextEmbeddingService(config);
}

describe('TextEmbeddingService.embedWithSource', () => {
  afterEach(() => jest.resetAllMocks());

  it('reports source=remote when the embedding server responds', async () => {
    mockedPost.mockResolvedValue({ data: { data: [{ embedding: [0.1, 0.2, 0.3] }] } });
    const result = await makeService().embedWithSource('테스트');
    expect(result.source).toBe('remote');
    expect(result.vector).toHaveLength(1024); // normalizeDimensions 패딩 (기본 차원)
    expect(result.remoteDimensions).toBe(3); // 정규화 전 원본 차원 (차원 불일치 감지용)
  });

  it('falls back to source=hash when the embedding server is unavailable', async () => {
    mockedPost.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await makeService().embedWithSource('테스트');
    expect(result.source).toBe('hash');
    expect(result.vector).toHaveLength(1024);
    expect(result.remoteDimensions).toBeUndefined(); // hash 폴백은 원본 차원 없음
  });

  it('embed() still returns just the vector', async () => {
    mockedPost.mockRejectedValue(new Error('down'));
    const vector = await makeService().embed('테스트');
    expect(Array.isArray(vector)).toBe(true);
    expect(vector).toHaveLength(1024);
  });
});

describe('TextEmbeddingService embedding endpoint routing', () => {
  afterEach(() => jest.resetAllMocks());

  it('uses LLM_EMBEDDING_BASE_URL when set (separate embedding server)', async () => {
    mockedPost.mockResolvedValue({ data: { data: [{ embedding: [0.1] }] } });
    await makeService({ LLM_EMBEDDING_BASE_URL: 'http://localhost:8081/v1' }).embed('테스트');
    expect(mockedPost).toHaveBeenCalledWith(
      'http://localhost:8081/v1/embeddings',
      expect.anything(),
      expect.anything(),
    );
  });

  it('falls back to LLM_BASE_URL when embedding base url is unset', async () => {
    mockedPost.mockResolvedValue({ data: { data: [{ embedding: [0.1] }] } });
    await makeService({ LLM_BASE_URL: 'http://localhost:8080/v1' }).embed('테스트');
    expect(mockedPost).toHaveBeenCalledWith(
      'http://localhost:8080/v1/embeddings',
      expect.anything(),
      expect.anything(),
    );
  });
});
