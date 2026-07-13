/// <reference types="jest" />

import axios from 'axios';
import { VisionAnalyzer } from '../../src/preference-analyzer/vision.analyzer';
import type { TasteTagDto } from '@tripick/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function config() {
  return { get: <T>(_key: string, def?: T) => def } as any;
}

function llmReply(tags: TasteTagDto) {
  return { data: { choices: [{ message: { content: JSON.stringify(tags) } }] } };
}

describe('VisionAnalyzer.analyzeImage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('parses the taste tags returned by the vision model', async () => {
    mockedAxios.post.mockResolvedValue(
      llmReply({ food: ['cafe'], mood: ['healing'], environment: ['nature'], confidence: 0.9 }),
    );
    const analyzer = new VisionAnalyzer(config());

    const tags = await analyzer.analyzeImage('http://img/1.jpg');
    expect(tags).toEqual({
      food: ['cafe'],
      mood: ['healing'],
      environment: ['nature'],
      confidence: 0.9,
    });
  });

  it('returns empty tags with zero confidence when the call fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('llm down'));
    const analyzer = new VisionAnalyzer(config());

    const tags = await analyzer.analyzeImage('http://img/1.jpg');
    expect(tags).toEqual({ food: [], mood: [], environment: [], confidence: 0 });
  });
});

describe('VisionAnalyzer.analyzeMultiple', () => {
  it('keeps only tags reaching the majority threshold and averages confidence', async () => {
    const analyzer = new VisionAnalyzer(config());
    jest
      .spyOn(analyzer, 'analyzeImage')
      .mockResolvedValueOnce({ food: ['cafe'], mood: ['healing'], environment: ['nature'], confidence: 0.8 })
      .mockResolvedValueOnce({ food: ['cafe'], mood: ['adventure'], environment: ['nature'], confidence: 0.6 })
      .mockResolvedValueOnce({ food: ['korean'], mood: ['healing'], environment: ['city'], confidence: 0.4 });

    const tags = await analyzer.analyzeMultiple(['a', 'b', 'c']);

    // threshold = ceil(3/2) = 2. cafe(2), nature(2), healing(2) 는 유지, 1회 등장 태그는 제거.
    expect(tags.food).toEqual(['cafe']);
    expect(tags.environment).toEqual(['nature']);
    expect(tags.mood).toEqual(['healing']);
    expect(tags.confidence).toBeCloseTo((0.8 + 0.6 + 0.4) / 3, 5);
  });

  it('returns zero confidence for an empty image list', async () => {
    const analyzer = new VisionAnalyzer(config());
    const tags = await analyzer.analyzeMultiple([]);
    expect(tags).toEqual({ food: [], mood: [], environment: [], confidence: 0 });
  });
});
