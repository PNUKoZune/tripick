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

describe('VisionAnalyzer.analyzeImage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('parses the taste tags returned by the vision model', async () => {
    mockedAxios.post.mockResolvedValue(
      tagReply({ food: ['cafe'], mood: ['healing'], environment: ['nature'], confidence: 0.9 }),
    );

    const tags = await new VisionAnalyzer(config()).analyzeImage('data:image/jpeg;base64,AAAA');

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
    ).analyzeImage('data:image/png;base64,BBBB');

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
    ).analyzeImage('data:image/png;base64,BBBB');

    const [url, body] = mockedAxios.post.mock.calls[0] as [string, any];
    expect(url).toBe('http://vision:8082/v1/chat/completions');
    expect(body.model).toBe('gemma-4-vision');
  });

  it('extracts JSON even when the model wraps it in a code fence', async () => {
    mockedAxios.post.mockResolvedValue(
      llmReply('```json\n{"food":["cafe"],"mood":[],"environment":[],"confidence":0.7}\n```'),
    );

    const tags = await new VisionAnalyzer(config()).analyzeImage('data:image/jpeg;base64,AAAA');

    expect(tags.food).toEqual(['cafe']);
    expect(tags.confidence).toBe(0.7);
  });

  it('drops tags outside the allowed vocabulary and normalizes casing', async () => {
    mockedAxios.post.mockResolvedValue(
      llmReply(
        '{"food":["Cafe","korean food","sushi"],"mood":["HEALING"],"environment":["desert"],"confidence":0.8}',
      ),
    );

    const tags = await new VisionAnalyzer(config()).analyzeImage('data:image/jpeg;base64,AAAA');

    expect(tags.food).toEqual(['cafe']);
    expect(tags.mood).toEqual(['healing']);
    expect(tags.environment).toEqual([]);
  });

  it('clamps out-of-range confidence', async () => {
    mockedAxios.post.mockResolvedValue(tagReply({ food: ['cafe'], confidence: 4.2 }));

    const tags = await new VisionAnalyzer(config()).analyzeImage('data:image/jpeg;base64,AAAA');

    expect(tags.confidence).toBe(1);
  });

  it('zeroes confidence when no tag survives validation', async () => {
    mockedAxios.post.mockResolvedValue(
      llmReply('{"food":["pizza"],"mood":[],"environment":[],"confidence":0.9}'),
    );

    const tags = await new VisionAnalyzer(config()).analyzeImage('data:image/jpeg;base64,AAAA');

    expect(tags).toEqual({ food: [], mood: [], environment: [], confidence: 0 });
  });

  it('returns empty tags when the model answers with prose only', async () => {
    mockedAxios.post.mockResolvedValue(llmReply('죄송하지만 이미지를 분석할 수 없습니다.'));

    const tags = await new VisionAnalyzer(config()).analyzeImage('data:image/jpeg;base64,AAAA');

    expect(tags).toEqual({ food: [], mood: [], environment: [], confidence: 0 });
  });

  it('returns empty tags with zero confidence when the call fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('llm down'));

    const tags = await new VisionAnalyzer(config()).analyzeImage('data:image/jpeg;base64,AAAA');

    expect(tags).toEqual({ food: [], mood: [], environment: [], confidence: 0 });
  });
});

describe('VisionAnalyzer.analyzePhoto', () => {
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

describe('VisionAnalyzer.analyzeMultiple', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps tags reaching the agreement threshold and averages confidence', async () => {
    const analyzer = new VisionAnalyzer(config());
    jest
      .spyOn(analyzer, 'analyzeImage')
      .mockResolvedValueOnce({ food: ['cafe'], mood: ['healing'], environment: ['nature'], confidence: 0.8 })
      .mockResolvedValueOnce({ food: ['cafe'], mood: ['adventure'], environment: ['nature'], confidence: 0.6 })
      .mockResolvedValueOnce({ food: ['korean'], mood: ['healing'], environment: ['city'], confidence: 0.4 });

    const tags = await analyzer.analyzeMultiple(['a', 'b', 'c']);

    // 3장 → threshold 2. 2회 이상 등장한 태그만 남는다.
    expect(tags.food).toEqual(['cafe']);
    expect(tags.mood).toEqual(['healing']);
    expect(tags.environment).toEqual(['nature']);
    expect(tags.confidence).toBeCloseTo((0.8 + 0.6 + 0.4) / 3, 5);
  });

  it('ignores images that produced no tags when averaging confidence', async () => {
    const analyzer = new VisionAnalyzer(config());
    jest
      .spyOn(analyzer, 'analyzeImage')
      .mockResolvedValueOnce({ food: ['cafe'], mood: [], environment: [], confidence: 0.8 })
      .mockResolvedValueOnce({ food: [], mood: [], environment: [], confidence: 0 });

    const tags = await analyzer.analyzeMultiple(['a', 'b']);

    // 실패한 b 가 평균을 끌어내리지 않는다.
    expect(tags.food).toEqual(['cafe']);
    expect(tags.confidence).toBeCloseTo(0.8, 5);
  });

  it('caps each category to the top tags by frequency', async () => {
    const analyzer = new VisionAnalyzer(config());
    const spy = jest.spyOn(analyzer, 'analyzeImage');
    // 4장 → threshold 2. korean 4, cafe 3, japanese 2, western 2 중 상위 3개만.
    spy.mockResolvedValueOnce({ food: ['korean', 'cafe', 'japanese'], mood: [], environment: [], confidence: 0.5 });
    spy.mockResolvedValueOnce({ food: ['korean', 'cafe', 'japanese'], mood: [], environment: [], confidence: 0.5 });
    spy.mockResolvedValueOnce({ food: ['korean', 'cafe', 'western'], mood: [], environment: [], confidence: 0.5 });
    spy.mockResolvedValueOnce({ food: ['korean', 'western'], mood: [], environment: [], confidence: 0.5 });

    const tags = await analyzer.analyzeMultiple(['a', 'b', 'c', 'd']);

    expect(tags.food).toEqual(['korean', 'cafe', 'japanese']);
  });

  it('keeps single-image tags without requiring agreement', async () => {
    const analyzer = new VisionAnalyzer(config());
    jest
      .spyOn(analyzer, 'analyzeImage')
      .mockResolvedValue({ food: ['cafe'], mood: ['romantic'], environment: [], confidence: 0.7 });

    const tags = await analyzer.analyzeMultiple(['a']);

    expect(tags.food).toEqual(['cafe']);
    expect(tags.mood).toEqual(['romantic']);
  });

  it('returns zero confidence for an empty image list', async () => {
    const tags = await new VisionAnalyzer(config()).analyzeMultiple([]);
    expect(tags).toEqual({ food: [], mood: [], environment: [], confidence: 0 });
  });

  it('returns empty tags when every image failed', async () => {
    const analyzer = new VisionAnalyzer(config());
    jest
      .spyOn(analyzer, 'analyzeImage')
      .mockResolvedValue({ food: [], mood: [], environment: [], confidence: 0 });

    const tags = await analyzer.analyzeMultiple(['a', 'b']);

    expect(tags).toEqual({ food: [], mood: [], environment: [], confidence: 0 });
  });

  it('analyzes images one at a time by default', async () => {
    const analyzer = new VisionAnalyzer(config());
    let inFlight = 0;
    let peak = 0;
    jest.spyOn(analyzer, 'analyzeImage').mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return { food: ['cafe'], mood: [], environment: [], confidence: 0.5 };
    });

    await analyzer.analyzeMultiple(['a', 'b', 'c']);

    expect(peak).toBe(1);
  });
});
