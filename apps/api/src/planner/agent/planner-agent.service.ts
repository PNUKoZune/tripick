import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { ReplanTrigger, RouteMode, TasteTagDto } from '@tripick/types';
import type { CandidatePlace } from '../retrieval/types';
import {
  defaultVisitDuration,
  distributeFallbackDurations,
} from '../helpers/itinerary-density';

export interface PlannerAgentOptions {
  destination: string;
  /**
   * 계획할 각 day 의 실제 날짜(`YYYY-MM-DD`). 인덱스 i = 프롬프트상 `day` i+1.
   * 부분 재계획이면 대상 일차의 날짜만 들어오고, `[1,3]` 처럼 **연속이 아닐 수 있다** —
   * 그래서 시작·종료일 두 값이 아니라 날짜 목록을 넘긴다(두 값은 비연속 범위를 표현하지 못해
   * `dayCount` 와 어긋난 기간을 프롬프트에 실었다). 길이는 항상 `dayCount` 와 같다.
   */
  dayDates: string[];
  wakeTime: string;
  sleepTime: string;
  transportMode: RouteMode;
  dayCount: number;
  minimumItemsPerDay: number;
  itemsPerDay: number;
  candidates: CandidatePlace[];
  tasteTags?: TasteTagDto;
  trigger?: ReplanTrigger;
  notes?: string | null;
  weatherHint: string;
}

export interface PlannedCandidate {
  candidate: CandidatePlace;
  day: number;
  order: number;
  durationMin: number;
  memo: string;
  aiGenerated: boolean;
}

interface LlmPlanResponse {
  items?: Array<{
    candidateId?: string;
    day?: number;
    order?: number;
    durationMin?: number;
    memo?: string;
  }>;
}

@Injectable()
export class PlannerAgentService {
  private readonly logger = new Logger(PlannerAgentService.name);

  constructor(private readonly config: ConfigService) {}

  async plan(options: PlannerAgentOptions): Promise<PlannedCandidate[]> {
    const fallback = this.buildFallbackPlan(options);
    if (!this.enabled()) {
      return fallback;
    }

    try {
      const response = await this.callPlannerModel(options);
      const parsed = this.parseModelPlan(response, options);
      if (parsed.length < Math.min(options.candidates.length, options.dayCount * options.itemsPerDay)) {
        this.logger.warn('AI planner returned too few valid items, using deterministic fallback');
        return fallback;
      }

      this.logger.log(`AI planner generated ${parsed.length} itinerary selections`);
      return parsed;
    } catch (error) {
      this.logger.warn(
        `AI planner unavailable, using deterministic fallback: ${error instanceof Error ? error.message : String(error)}`,
      );
      return fallback;
    }
  }

  private async callPlannerModel(options: PlannerAgentOptions): Promise<string> {
    const baseUrl = this.config.get<string>('LLM_BASE_URL', 'http://localhost:8080/v1');
    const apiKey = this.config.get<string>('LLM_API_KEY', 'local');
    const model = this.config.get<string>('LLM_MODEL', 'gemma-4');
    const timeout = this.readNumber('LLM_PLANNER_TIMEOUT_MS', 12000);

    const res = await axios.post<{
      choices: Array<{ message: { content: string } }>;
    }>(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are TriPick Planner Agent. Build balanced full-day routes from provided candidate places only. Return strict JSON only. Do not invent places, addresses, or coordinates.',
          },
          {
            role: 'user',
            content: this.buildPrompt(options),
          },
        ],
        temperature: this.readNumber('LLM_PLANNER_TEMPERATURE', 0.2),
        response_format: { type: 'json_object' },
      },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout },
    );

    return res.data.choices[0]?.message.content ?? '{}';
  }

  private buildPrompt(options: PlannerAgentOptions): string {
    const taste = options.tasteTags
      ? [
          ...options.tasteTags.food,
          ...options.tasteTags.mood,
          ...options.tasteTags.environment,
        ].join(', ')
      : 'none';
    const targetCount = options.dayCount * options.itemsPerDay;
    const candidates = options.candidates.slice(0, targetCount + 6).map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      category: candidate.category,
      address: candidate.address,
      openingHours: candidate.openingHours ?? null,
      tags: candidate.tags,
      confidence: candidate.confidence,
      source: candidate.source,
      reason: candidate.reason,
    }));

    return JSON.stringify({
      task: 'Create a travel itinerary plan from retrieved candidates.',
      hardRules: [
        'Use only candidateId values from candidates.',
        'Do not create new places.',
        `Return exactly ${Math.min(targetCount, options.candidates.length)} items if possible.`,
        `day must be between 1 and ${options.dayCount}.`,
        'day 의 실제 날짜는 trip.days 를 따른다. 날짜가 연속이 아닐 수 있으므로 day 간 간격을 이어진 하루로 가정하지 않는다.',
        `order must be between 1 and ${options.itemsPerDay}.`,
        `일정 강도별 기본 ${options.minimumItemsPerDay}개는 최소 기준이지 상한이 아니다. 활동 시간이 길어 계산된 하루 목표 ${options.itemsPerDay}개를 가능한 모두 사용한다.`,
        'durationMin must be 45-150.',
        'Prefer high confidence candidates, but category balance beats small confidence differences.',
        '카페는 하루 최대 1개만 배치한다. 후보가 부족할 때만 예외로 2개까지 허용하고 memo에 이유를 쓴다.',
        '같은 category를 연속 배치하지 않는다. 특히 cafe-cafe, restaurant-restaurant 연속 배치는 피한다.',
        '하루마다 attraction, park, cultural 계열 후보를 가능한 2개 이상 포함해 여행 목적지를 실제로 둘러보게 한다.',
        'restaurant는 점심/저녁 역할로 하루 1-2개 배치하고, cafe는 이동 중 휴식 슬롯으로만 쓴다.',
        '하루 방문 체류 시간 합계가 기상-취침 가능 시간의 75-85%가 되도록 durationMin을 적극적으로 사용한다.',
        '이동시간까지 고려했을 때 마지막 일정이 sleepTime 30-90분 전에 끝나는 종일 동선을 목표로 한다.',
        '짧은 cafe/restaurant 위주로 일찍 끝나는 일정을 만들지 말고, 긴 체류 attraction을 중심축으로 둔다.',
        'Respect wake/sleep/opening hours as much as possible.',
      ],
      durationGuide: {
        cafe: '45-70 minutes, never used as the main day filler',
        restaurant: '75-100 minutes around meal slots',
        attraction: '110-150 minutes for core destination visits',
        park: '90-150 minutes for walks or outdoor anchor visits',
      },
      dayRhythmGuide: [
        'morning: attraction/park anchor',
        'midday: restaurant',
        'afternoon: attraction/cultural anchor',
        'late day: cafe or additional attraction, not a second cafe unless unavoidable',
      ],
      outputSchema: {
        items: [
          {
            candidateId: 'candidate id from candidates',
            day: 1,
            order: 1,
            durationMin: 90,
            memo: 'short Korean reason based on taste/confidence/context',
          },
        ],
      },
      trip: {
        destination: options.destination,
        days: options.dayDates.map((date, index) => ({ day: index + 1, date })),
        wakeTime: options.wakeTime,
        sleepTime: options.sleepTime,
        transportMode: options.transportMode,
        dayCount: options.dayCount,
        minimumItemsPerDay: options.minimumItemsPerDay,
        targetItemsPerDay: options.itemsPerDay,
        trigger: options.trigger ?? 'initial',
        notes: options.notes ?? null,
        taste,
        weatherHint: options.weatherHint,
      },
      candidates,
    });
  }

  private parseModelPlan(content: string, options: PlannerAgentOptions): PlannedCandidate[] {
    const parsed = JSON.parse(content) as LlmPlanResponse;
    const rows = Array.isArray(parsed.items) ? parsed.items : [];
    const candidateById = new Map(options.candidates.map((candidate) => [candidate.id, candidate]));
    const seenCandidateIds = new Set<string>();
    const seenSlots = new Set<string>();
    const planned: PlannedCandidate[] = [];

    for (const row of rows) {
      const candidateId = typeof row.candidateId === 'string' ? row.candidateId : '';
      const candidate = candidateById.get(candidateId);
      if (!candidate || seenCandidateIds.has(candidate.id)) continue;

      const day = Number(row.day);
      const order = Number(row.order);
      if (!Number.isInteger(day) || day < 1 || day > options.dayCount) continue;
      if (!Number.isInteger(order) || order < 1 || order > options.itemsPerDay) continue;

      const slot = `${day}:${order}`;
      if (seenSlots.has(slot)) continue;
      seenSlots.add(slot);
      seenCandidateIds.add(candidate.id);

      planned.push({
        candidate,
        day,
        order,
        durationMin: this.normalizeDuration(row.durationMin, candidate.category),
        memo: this.normalizeMemo(row.memo),
        aiGenerated: true,
      });
    }

    return planned.sort((a, b) => a.day - b.day || a.order - b.order);
  }

  private buildFallbackPlan(options: PlannerAgentOptions): PlannedCandidate[] {
    const planned: PlannedCandidate[] = [];
    for (let day = 1; day <= options.dayCount; day += 1) {
      const offset = (day - 1) * options.itemsPerDay;
      const dayCandidates = options.candidates.slice(offset, offset + options.itemsPerDay);
      const durations = distributeFallbackDurations(
        dayCandidates.map((candidate) => candidate.category),
        options.wakeTime,
        options.sleepTime,
      );
      dayCandidates.forEach((candidate, index) => {
        planned.push({
          candidate,
          day,
          order: index + 1,
          durationMin: durations[index] ?? defaultVisitDuration(candidate.category),
          memo: 'AI planner fallback: CRAG 후보 순위 기반 배치',
          aiGenerated: false,
        });
      });
    }
    return planned;
  }

  private normalizeDuration(value: unknown, category: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return defaultVisitDuration(category);
    return Math.max(45, Math.min(150, Math.round(parsed)));
  }

  private normalizeMemo(value: unknown): string {
    if (typeof value !== 'string') return 'AI planner가 CRAG 후보를 일정 맥락에 맞게 배치';
    const trimmed = value.trim();
    if (!trimmed) return 'AI planner가 CRAG 후보를 일정 맥락에 맞게 배치';
    return trimmed.slice(0, 160);
  }

  private enabled(): boolean {
    const raw = this.config.get<string>('LLM_PLANNER_ENABLED', 'true');
    return raw !== 'false';
  }

  private readNumber(key: string, fallback: number): number {
    const parsed = Number(this.config.get<string | number>(key, fallback));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
