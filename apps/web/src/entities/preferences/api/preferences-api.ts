import type {
  EnvironmentPreference,
  FoodPreference,
  MoodPreference,
  PreferenceDto,
  PreferenceProfileDto,
  UpdatePreferenceDto,
} from '@tripick/types';
import { api } from '@/shared/api/client';
import { STYLE_TO_TASTE } from '../model/options';

export type PreferenceFormState = PreferenceProfileDto;

export const DEFAULT_PREFERENCE_FORM: PreferenceFormState = {
  travelStyles: ['korean_vibe', 'food_trip', 'insta_spot'],
  companions: ['couple'],
  sleepTime: '23:00',
  wakeTime: '07:30',
  transportModes: ['transit', 'walk'],
  instagramConnected: false,
  instagramTags: ['미식', '자연', '도시'],
};

export function getMyPreferences(token: string) {
  return api.get<PreferenceDto | null>('/preferences', token);
}

export function savePreferences(token: string, profile: PreferenceFormState) {
  return api.put<PreferenceDto>('/preferences', buildPreferencePayload(profile), token);
}

function buildPreferencePayload(profile: PreferenceFormState): UpdatePreferenceDto {
  const food = new Set<FoodPreference>();
  const mood = new Set<MoodPreference>();
  const environment = new Set<EnvironmentPreference>();

  for (const style of profile.travelStyles) {
    const taste = STYLE_TO_TASTE[style];
    taste.food.forEach((item) => food.add(item));
    taste.mood.forEach((item) => mood.add(item));
    taste.environment.forEach((item) => environment.add(item));
  }

  return {
    tasteTags: {
      food: Array.from(food),
      mood: Array.from(mood),
      environment: Array.from(environment),
      confidence: profile.instagramConnected ? 0.94 : 0.82,
    },
    profile,
  };
}
