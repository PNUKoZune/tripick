import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ItineraryService } from '../itinerary/itinerary.service';
import { PreferencesService } from '../preferences/preferences.service';
import { WeatherHelper } from './helpers/weather.helper';
import { RouteHelper } from './helpers/route.helper';
import { PreferenceHelper } from './helpers/preference.helper';
import { ScheduleConstraint } from './helpers/schedule.constraint';
import { ConstraintEngine } from './constraint/constraint.engine';
import type { ItineraryItemDto, ReplanRequestDto } from '@tripick/types';

/**
 * Planner Agent Orchestrator
 *
 * 흐름:
 * 1. 취향 RAG로 후보 장소 조회 (PreferenceHelper)
 * 2. 날씨 조회 및 동선 조정 힌트 생성 (WeatherHelper)
 * 3. Local LLM에 프롬프트 전송 → JSON 일정 생성
 * 4. Constraint Engine으로 제약 검증 (영업시간·이동시간·취침)
 * 5. 검증 통과 시 ItineraryService에 저장
 */
@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(
    private readonly itineraryService: ItineraryService,
    private readonly preferencesService: PreferencesService,
    private readonly weatherHelper: WeatherHelper,
    private readonly routeHelper: RouteHelper,
    private readonly preferenceHelper: PreferenceHelper,
    private readonly scheduleConstraint: ScheduleConstraint,
    private readonly constraintEngine: ConstraintEngine,
    private readonly config: ConfigService,
  ) {}

  async generateItinerary(tripId: string): Promise<ItineraryItemDto[]> {
    this.logger.log(`Generating itinerary for trip: ${tripId}`);

    // TODO: trip 정보 조회 후 각 helper 호출
    // const weather = await this.weatherHelper.getForecast(destination, startDate);
    // const candidates = await this.preferenceHelper.getCandidates(userId, destination);
    // const plan = await this.callLlm(buildPrompt({ trip, weather, candidates }));
    // const validated = await this.constraintEngine.validate(plan);
    // return this.itineraryService.bulkUpsert(validated);

    return [];
  }

  async replan(request: ReplanRequestDto): Promise<ItineraryItemDto[]> {
    this.logger.log(`Replanning trip: ${request.tripId}, trigger: ${request.trigger}`);

    // TODO: 현재 일정 조회 → 변경 사항 컨텍스트 주입 → LLM 재계획
    return [];
  }

  private async callLlm(prompt: string): Promise<unknown> {
    const baseUrl = this.config.get<string>('LLM_BASE_URL', 'http://localhost:8080/v1');
    const model = this.config.get<string>('LLM_MODEL', 'gemma-4');
    const apiKey = this.config.get<string>('LLM_API_KEY', 'local');

    const res = await axios.post<{ choices: Array<{ message: { content: string } }> }>(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [
          { role: 'system', content: '당신은 국내 여행 일정을 JSON으로 생성하는 AI 플래너입니다.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      },
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    const content = res.data.choices[0]?.message.content ?? '{}';
    return JSON.parse(content);
  }
}
