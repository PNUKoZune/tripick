/// <reference types="jest" />

import axios from 'axios';
import { PlannerAgentService } from '../../../src/planner/agent/planner-agent.service';
import type { PlannerAgentOptions } from '../../../src/planner/agent/planner-agent.service';
import type { CandidatePlace } from '../../../src/planner/retrieval/types';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PlannerAgentService', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
  });

  it('uses OpenAI-compatible chat completions to turn CRAG candidates into a plan', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [
                  { candidateId: 'busan-cafe', day: 1, order: 1, durationMin: 70, memo: '바다 취향과 카페 선호를 함께 반영' },
                  { candidateId: 'busan-food', day: 1, order: 2, durationMin: 85, memo: '점심 동선에 맞는 한식 후보' },
                ],
              }),
            },
          },
        ],
      },
    });

    const service = new PlannerAgentService(fakeConfig({ LLM_PLANNER_ENABLED: 'true' }));
    const plan = await service.plan(baseOptions());

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://localhost:8080/v1/chat/completions',
      expect.objectContaining({
        model: 'gemma-4',
        response_format: { type: 'json_object' },
      }),
      expect.objectContaining({
        headers: { Authorization: 'Bearer local' },
      }),
    );
    expect(plan).toHaveLength(2);
    expect(plan[0]!.candidate.id).toBe('busan-cafe');
    expect(plan[0]!.aiGenerated).toBe(true);
    expect(plan[0]!.memo).toContain('카페 선호');
  });

  it('sends daily balance and time-fill rules to the planner model', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [
                  { candidateId: 'busan-cafe', day: 1, order: 1, durationMin: 65, memo: '휴식용 카페' },
                  { candidateId: 'busan-food', day: 1, order: 2, durationMin: 90, memo: '식사 시간대 식당' },
                ],
              }),
            },
          },
        ],
      },
    });

    const service = new PlannerAgentService(fakeConfig({ LLM_PLANNER_ENABLED: 'true' }));
    await service.plan(baseOptions());

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('카페는 하루 최대 1개'),
          }),
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('하루 방문 체류 시간 합계가 기상-취침 가능 시간의 70-85%'),
          }),
        ]),
      }),
      expect.any(Object),
    );
  });

  it('falls back to deterministic CRAG order when the LLM is disabled', async () => {
    const service = new PlannerAgentService(fakeConfig({ LLM_PLANNER_ENABLED: 'false' }));
    const plan = await service.plan(baseOptions());

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(plan.map((item) => item.candidate.id)).toEqual(['busan-cafe', 'busan-food']);
    expect(plan.every((item) => item.aiGenerated === false)).toBe(true);
  });
});

function fakeConfig(values: Record<string, string>) {
  return {
    get<T = string>(key: string, fallback?: T): T {
      return (values[key] ?? fallback ?? defaultValue(key)) as T;
    },
  } as any;
}

function defaultValue(key: string): string {
  return {
    LLM_BASE_URL: 'http://localhost:8080/v1',
    LLM_API_KEY: 'local',
    LLM_MODEL: 'gemma-4',
    LLM_PLANNER_TIMEOUT_MS: '12000',
    LLM_PLANNER_TEMPERATURE: '0.2',
  }[key] ?? '';
}

function baseOptions(): PlannerAgentOptions {
  return {
    destination: '부산',
    startDate: '2026-07-01',
    endDate: '2026-07-01',
    wakeTime: '09:00',
    sleepTime: '22:00',
    transportMode: 'transit',
    dayCount: 1,
    itemsPerDay: 2,
    candidates: [candidate('busan-cafe', '광안리 브런치 카페', 'cafe'), candidate('busan-food', '기장 해산물 식당', 'restaurant')],
    tasteTags: {
      food: ['cafe'],
      mood: ['romantic'],
      environment: ['beach'],
      confidence: 0.9,
    },
    weatherHint: '날씨 양호, 실외 일정 가능.',
  };
}

function candidate(id: string, name: string, category: string): CandidatePlace {
  return {
    id,
    name,
    category,
    address: '부산 수영구 광안해변로 219',
    coordinates: { lat: 35.1532, lng: 129.1185 },
    source: 'pgvector',
    tags: ['cafe', 'beach', 'romantic'],
    confidence: 0.82,
    reason: '선호 태그 cafe, beach 일치, pgvector confidence 82%',
    crag: {
      total: 0.82,
      retrieval: 0.82,
      taste: 0.9,
      locality: 0.9,
      context: 0.7,
      availability: 0.6,
      dataQuality: 0.8,
      matchedTags: ['cafe', 'beach'],
      penalties: [],
    },
  };
}
