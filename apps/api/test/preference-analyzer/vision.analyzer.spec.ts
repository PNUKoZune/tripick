/// <reference types="jest" />

import axios from 'axios';
import { VisionAnalyzer } from '../../src/preference-analyzer/vision.analyzer';
import type { TasteTagDto } from '@tripick/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function config(overrides: Record<string, unknown> = {}) {
  return {
    get: <T>(key: string, def?: T) => (key in overrides ? (overrides[key] as T) : def),
  } as any;
}

function llmReply(content: string) {
  return { data: { choices: [{ message: { content } }] } };
}

function tagReply(tags: Partial<TasteTagDto>) {
  return llmReply(JSON.stringify(tags));
}

describe('VisionAnalyzer.analyzePhoto 응답 파싱', () => {
  beforeEach(() => jest.clearAllMocks());

  it('parses the taste tags returned by the vision model', async () => {
    mockedAxios.post.mockResolvedValue(
      tagReply({ food: ['cafe'], mood: ['healing'], environment: ['nature'], confidence: 0.9 }),
    );

    const tags = (await new VisionAnalyzer(config()).analyzePhoto('data:image/jpeg;base64,AAAA')).tags;

    expect(tags).toEqual({
      food: ['cafe'],
      mood: ['healing'],
      environment: ['nature'],
      confidence: 0.9,
    });
  });

  it('sends the image as an image_url part to the configured vision model', async () => {
    mockedAxios.post.mockResolvedValue(tagReply({ food: ['cafe'], confidence: 0.5 }));

    await new VisionAnalyzer(
      config({ LLM_BASE_URL: 'http://llm:8080/v1', LLM_MODEL: 'gemma-4' }),
    ).analyzePhoto('data:image/png;base64,BBBB');

    const [url, body, options] = mockedAxios.post.mock.calls[0] as [string, any, any];
    expect(url).toBe('http://llm:8080/v1/chat/completions');
    expect(body.model).toBe('gemma-4');
    expect(body.messages[1].content[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,BBBB' },
    });
    expect(options.timeout).toBe(90000);
  });

  it('falls back to a dedicated vision server when configured', async () => {
    mockedAxios.post.mockResolvedValue(tagReply({ mood: ['healing'], confidence: 0.5 }));

    await new VisionAnalyzer(
      config({
        LLM_BASE_URL: 'http://llm:8080/v1',
        LLM_VISION_BASE_URL: 'http://vision:8082/v1',
        LLM_VISION_MODEL: 'gemma-4-vision',
      }),
    ).analyzePhoto('data:image/png;base64,BBBB');

    const [url, body] = mockedAxios.post.mock.calls[0] as [string, any];
    expect(url).toBe('http://vision:8082/v1/chat/completions');
    expect(body.model).toBe('gemma-4-vision');
  });

  it('extracts JSON even when the model wraps it in a code fence', async () => {
    mockedAxios.post.mockResolvedValue(
      llmReply('```json\n{"food":["cafe"],"mood":[],"environment":[],"confidence":0.7}\n```'),
    );

    const tags = (await new VisionAnalyzer(config()).analyzePhoto('data:image/jpeg;base64,AAAA')).tags;

    expect(tags.food).toEqual(['cafe']);
    expect(tags.confidence).toBe(0.7);
  });

  it('drops tags outside the allowed vocabulary and normalizes casing', async () => {
    mockedAxios.post.mockResolvedValue(
      llmReply(
        '{"food":["Cafe","korean food","sushi"],"mood":["HEALING"],"environment":["desert"],"confidence":0.8}',
      ),
    );

    const tags = (await new VisionAnalyzer(config()).analyzePhoto('data:image/jpeg;base64,AAAA')).tags;

    expect(tags.food).toEqual(['cafe']);
    expect(tags.mood).toEqual(['healing']);
    expect(tags.environment).toEqual([]);
  });

  it('clamps out-of-range confidence', async () => {
    mockedAxios.post.mockResolvedValue(tagReply({ food: ['cafe'], confidence: 4.2 }));

    const tags = (await new VisionAnalyzer(config()).analyzePhoto('data:image/jpeg;base64,AAAA')).tags;

    expect(tags.confidence).toBe(1);
  });

  it('zeroes confidence when no tag survives validation', async () => {
    mockedAxios.post.mockResolvedValue(
      llmReply('{"food":["pizza"],"mood":[],"environment":[],"confidence":0.9}'),
    );

    const tags = (await new VisionAnalyzer(config()).analyzePhoto('data:image/jpeg;base64,AAAA')).tags;

    expect(tags).toEqual({ food: [], mood: [], environment: [], confidence: 0 });
  });

  it('returns empty tags when the model answers with prose only', async () => {
    mockedAxios.post.mockResolvedValue(llmReply('죄송하지만 이미지를 분석할 수 없습니다.'));

    const tags = (await new VisionAnalyzer(config()).analyzePhoto('data:image/jpeg;base64,AAAA')).tags;

    expect(tags).toEqual({ food: [], mood: [], environment: [], confidence: 0 });
  });

  it('returns empty tags with zero confidence when the call fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('llm down'));

    const tags = (await new VisionAnalyzer(config()).analyzePhoto('data:image/jpeg;base64,AAAA')).tags;

    expect(tags).toEqual({ food: [], mood: [], environment: [], confidence: 0 });
  });
});

describe('VisionAnalyzer.analyzePhoto 성공·실패 구분', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marks a real answer as ok even when no tag was found', async () => {
    mockedAxios.post.mockResolvedValue(
      llmReply('{"food":[],"mood":[],"environment":[],"confidence":0.4}'),
    );

    const result = await new VisionAnalyzer(config()).analyzePhoto('data:image/png;base64,AAAA');

    // "분석했으나 취향 없음" 은 유효한 결론이라 재시도 대상이 아니다
    expect(result.ok).toBe(true);
    expect(result.tags.food).toEqual([]);
  });

  it('marks a failed call as not ok so the caller can retry', async () => {
    mockedAxios.post.mockRejectedValue(new Error('timeout of 90000ms exceeded'));

    const result = await new VisionAnalyzer(config()).analyzePhoto('data:image/png;base64,AAAA');

    expect(result.ok).toBe(false);
    expect(result.tags).toEqual({ food: [], mood: [], environment: [], confidence: 0 });
  });
});

describe('VisionAnalyzer.aggregate', () => {
  const photo = (partial: Partial<TasteTagDto>): TasteTagDto => ({
    food: [],
    mood: [],
    environment: [],
    confidence: 0,
    ...partial,
  });
  const analyzer = () => new VisionAnalyzer(config());

  it('keeps tags reaching the agreement threshold and averages confidence', () => {
    const tags = analyzer().aggregate([
      photo({ food: ['cafe'], mood: ['healing'], environment: ['nature'], confidence: 0.8 }),
      photo({ food: ['cafe'], mood: ['adventure'], environment: ['nature'], confidence: 0.6 }),
      photo({ food: ['korean'], mood: ['healing'], environment: ['city'], confidence: 0.4 }),
    ]);

    // 3장 → threshold 2. 2회 이상 등장한 태그만 남는다.
    expect(tags.food).toEqual(['cafe']);
    expect(tags.mood).toEqual(['healing']);
    expect(tags.environment).toEqual(['nature']);
    expect(tags.confidence).toBeCloseTo((0.8 + 0.6 + 0.4) / 3, 5);
  });

  it('ignores photos that produced no tags when averaging confidence', () => {
    const tags = analyzer().aggregate([
      photo({ food: ['cafe'], confidence: 0.8 }),
      photo({ confidence: 0 }),
    ]);

    // 태그가 없는 결과가 평균을 끌어내리지 않는다.
    expect(tags.food).toEqual(['cafe']);
    expect(tags.confidence).toBeCloseTo(0.8, 5);
  });

  it('caps each category to the top tags by frequency', () => {
    // 4장 → threshold 2. korean 4, cafe 3, japanese 2, western 2 중 상위 3개만.
    const tags = analyzer().aggregate([
      photo({ food: ['korean', 'cafe', 'japanese'], confidence: 0.5 }),
      photo({ food: ['korean', 'cafe', 'japanese'], confidence: 0.5 }),
      photo({ food: ['korean', 'cafe', 'western'], confidence: 0.5 }),
      photo({ food: ['korean', 'western'], confidence: 0.5 }),
    ]);

    expect(tags.food).toEqual(['korean', 'cafe', 'japanese']);
  });

  it('keeps single-photo tags without requiring agreement', () => {
    const tags = analyzer().aggregate([
      photo({ food: ['cafe'], mood: ['romantic'], confidence: 0.7 }),
    ]);

    expect(tags.food).toEqual(['cafe']);
    expect(tags.mood).toEqual(['romantic']);
  });

  it('returns zero confidence for an empty list', () => {
    expect(analyzer().aggregate([])).toEqual({
      food: [],
      mood: [],
      environment: [],
      confidence: 0,
    });
  });

  it('returns empty tags when no photo produced a tag', () => {
    expect(analyzer().aggregate([photo({}), photo({})])).toEqual({
      food: [],
      mood: [],
      environment: [],
      confidence: 0,
    });
  });
});
