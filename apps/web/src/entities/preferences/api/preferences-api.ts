import type { PreferenceDto, PreferenceProfileDto, TasteTagDto } from '@tripick/types';
import { api } from '@/shared/api/client';

export type PreferenceFormState = PreferenceProfileDto;

export const DEFAULT_PREFERENCE_FORM: PreferenceFormState = {
  sleepTime: '23:00',
  wakeTime: '07:30',
  transportModes: ['transit', 'walk'],
  likedThemes: [],
  dislikedThemes: [],
  pace: 'balanced',
  activityIntensity: 'moderate',
  crowdPreference: 'balanced',
};

/** 취향 사진 분석 결과 (vision analyzer → 취향 태그 추출) */
export type PreferenceImageAnalysis = {
  tasteTags: TasteTagDto;
  /** Object Storage 에 보관된 원본 사진 URL */
  photoUrls: string[];
  embeddingId: string;
  preferenceId: string;
};

export function getMyPreferences(token: string) {
  return api.get<PreferenceDto | null>('/preferences', token);
}

/**
 * 프로필만 저장한다. tasteTags 는 사진 분석에서만 채워지므로 여기서 보내지 않아
 * 사진으로 추출된 태그를 덮어쓰지 않는다. (테마 신호는 profile.likedThemes 로 임베딩에 반영됨)
 */
export function savePreferences(token: string, profile: PreferenceFormState) {
  return api.put<PreferenceDto>('/preferences', { profile }, token);
}

/** 사용자가 올린 사진을 업로드해 취향 태그를 분석·저장한다. */
export function analyzePreferenceImages(token: string, files: File[]) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('images', file);
  }
  return api.upload<PreferenceImageAnalysis>('/preference-analyzer/upload', formData, token);
}
