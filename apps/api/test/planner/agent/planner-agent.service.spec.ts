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
            content: expect.stringContaining('일정 강도별 기본 2개는 최소 기준이지 상한이 아니다'),
          }),
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('하루 방문 체류 시간 합계가 기상-취침 가능 시간의 75-85%'),
          }),
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('마지막 일정이 sleepTime 30-90분 전에 끝나는'),
          }),
        ]),
      }),
      expect.any(Object),
    );
  });

  it('tells the model where a partially spent day starts and how many slots are left', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { choices: [{ message: { content: JSON.stringify({ items: [] }) } }] },
    });

    const service = new PlannerAgentService(fakeConfig({ LLM_PLANNER_ENABLED: 'true' }));
    // 오늘을 15:10 부터 다시 짜는 재계획 — 남은 시간에 한 곳만 들어간다.
    await service.plan({ ...baseOptions(), dayStartTimes: ['15:10'], dayItemTargets: [1] });

    const prompt = (mockedAxios.post.mock.calls[0]![1] as any).messages[1].content as string;
    expect(prompt).toContain('"startTime":"15:10"');
    expect(prompt).toContain('"targetItems":1');
    // 하루가 이미 진행된 날에만 붙는 규칙.
    expect(prompt).toContain('아침 시간대(카페 브런치 등)를 다시 배치하지 않는다');
  });

  it('keeps the full-day prompt untouched when no day is anchored', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { choices: [{ message: { content: JSON.stringify({ items: [] }) } }] },
    });

    const service = new PlannerAgentService(fakeConfig({ LLM_PLANNER_ENABLED: 'true' }));
    await service.plan(baseOptions());

    const prompt = (mockedAxios.post.mock.calls[0]![1] as any).messages[1].content as string;
    expect(prompt).toContain('"startTime":"09:00"');
    expect(prompt).not.toContain('아침 시간대(카페 브런치 등)를 다시 배치하지 않는다');
  });

  it('slices the deterministic fallback per day target instead of a fixed size', async () => {
    const service = new PlannerAgentService(fakeConfig({ LLM_PLANNER_ENABLED: 'false' }));
    const plan = await service.plan({
      ...baseOptions(),
      dayDates: ['2026-07-01', '2026-07-02'],
      dayCount: 2,
      // 첫 일차는 남은 시간이 짧아 1곳, 다음 일차는 하루 목표(2곳).
      dayStartTimes: ['15:10', '09:00'],
      dayItemTargets: [1, 2],
    });

    // 후보가 2개뿐이므로 1일차 1곳 + 2일차 1곳. 오프셋을 누적하지 않으면 같은 후보가 두 번 쓰인다.
    expect(plan.map((item) => `${item.day}:${item.candidate.id}`)).toEqual([
      '1:busan-cafe',
      '2:busan-food',
    ]);
  });

  it('AI 가 슬롯을 덜 채우면 나머지만 메운다 (전량 폐기하지 않는다)', async () => {
    // 예전엔 목표 개수를 못 채우면 AI 결과를 통째로 버렸다. 중복 슬롯 하나만 있어도
    // 결정적 폴백으로 떨어져, 프롬프트를 고쳐도 일정에 반영될 길이 없었다.
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [{ candidateId: 'busan-cafe', day: 1, order: 1, durationMin: 60, memo: '카페' }],
              }),
            },
          },
        ],
      },
    });

    const service = new PlannerAgentService(fakeConfig({ LLM_PLANNER_ENABLED: 'true' }));
    const plan = await service.plan(baseOptions());

    expect(plan).toHaveLength(2);
    expect(plan[0]!.candidate.id).toBe('busan-cafe');
    expect(plan[0]!.aiGenerated).toBe(true);
    // 빈 자리는 그 시각의 슬롯 역할(점심 음식점)로 채운다.
    expect(plan[1]!.candidate.id).toBe('busan-food');
    expect(plan[1]!.aiGenerated).toBe(false);
  });

  it('결정적 폴백도 식사 슬롯을 먼저 채운다', async () => {
    const service = new PlannerAgentService(fakeConfig({ LLM_PLANNER_ENABLED: 'false' }));
    const plan = await service.plan({
      ...baseOptions(),
      itemsPerDay: 3,
      dayItemTargets: [3],
      candidates: [
        candidate('att-1', '해운대해수욕장', 'attraction'),
        candidate('att-2', '청사포', 'attraction'),
        candidate('att-3', '마린시티', 'attraction'),
        candidate('food-1', '기장 해산물 식당', 'restaurant'),
      ],
    });

    // 점수 순으로 자르면 관광지 3개로 끝난다 — 식사 자리를 코드가 먼저 잡아야 한다.
    expect(plan.map((item) => item.candidate.id)).toContain('food-1');
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
    dayDates: ['2026-07-01'],
    wakeTime: '09:00',
    sleepTime: '22:00',
    transportMode: 'transit',
    dayCount: 1,
    minimumItemsPerDay: 2,
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
      popularity: 0.7,
      matchedTags: ['cafe', 'beach'],
      penalties: [],
    },
  };
}
