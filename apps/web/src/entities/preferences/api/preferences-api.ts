import type {
  PreferenceAnalysisJobDto,
  PreferenceDto,
  PreferenceProfileDto,
  TasteTagDto,
} from '@tripick/types';
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

/** 진행 중인 분석 잡 ID 를 새로고침·페이지 이동 뒤에도 복원하기 위한 키 */
const ANALYSIS_JOB_KEY = 'tripick:preference-analysis-job';

export function rememberAnalysisJob(jobId: string) {
  try {
    window.localStorage.setItem(ANALYSIS_JOB_KEY, jobId);
  } catch {
    // 프라이빗 모드 등에서 실패해도 분석 자체는 서버에서 계속된다.
  }
}

export function readAnalysisJob(): string | null {
  try {
    return window.localStorage.getItem(ANALYSIS_JOB_KEY);
  } catch {
    return null;
  }
}

export function forgetAnalysisJob() {
  try {
    window.localStorage.removeItem(ANALYSIS_JOB_KEY);
  } catch {
    // 무시
  }
}

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

/**
 * 사진을 업로드하고 분석 잡을 등록한다.
 * 분석은 수십 초 걸려 응답을 기다리지 않고, 잡 ID 로 상태를 따로 조회한다.
 */
export function analyzePreferenceImages(token: string, files: File[]) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('images', file);
  }
  return api.upload<PreferenceAnalysisJobDto>('/preference-analyzer/upload', formData, token);
}

/** 분석 잡 진행 상태 조회. */
export function getPreferenceAnalysisJob(token: string, jobId: string) {
  return api.get<PreferenceAnalysisJobDto>(`/preference-analyzer/jobs/${jobId}`, token);
}

/** 저장된 취향 사진 한 장을 삭제한다 (스토리지 원본 + URL 제거 + 태그 재집계). */
export function deletePreferencePhoto(token: string, url: string) {
  return api.delete<{ photoUrls: string[]; tasteTags?: TasteTagDto }>(
    `/preference-analyzer/photos?url=${encodeURIComponent(url)}`,
    token,
  );
}
