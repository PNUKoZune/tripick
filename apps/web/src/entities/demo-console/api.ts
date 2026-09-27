import type {
  DemoConsoleStatusDto,
  DemoScenario,
  DemoScenarioRequestDto,
  DemoScenarioResultDto,
  DemoTripSummaryDto,
} from '@tripick/types';

import { api } from '@/shared/lib';

/**
 * 시연 콘솔 API.
 *
 * 서버가 `DEMO_CONSOLE_ENABLED` 로 켰을 때만 존재하는 라우트라, 꺼진 환경에서는 404 가 온다
 * (화면은 그 404 를 "콘솔 비활성" 안내로 바꿔 보여준다).
 */
export function fetchDemoStatus(target: DemoScenarioRequestDto = {}) {
  const params = new URLSearchParams();
  if (target.tripId) params.set('tripId', target.tripId);
  if (target.day) params.set('day', String(target.day));
  const query = params.toString();
  return api.get<DemoConsoleStatusDto>(`/demo/status${query ? `?${query}` : ''}`);
}

export function seedDemoTrip() {
  return api.post<DemoTripSummaryDto>('/demo/trip', {});
}

export function runDemoScenario(scenario: DemoScenario, body: DemoScenarioRequestDto = {}) {
  return api.post<DemoScenarioResultDto>(`/demo/scenarios/${scenario}`, body);
}

export function resetDemoState() {
  return api.post<DemoConsoleStatusDto>('/demo/reset', {});
}
