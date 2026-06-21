import type { KakaoAuthStatusDto, LoginResponseDto } from '@tripick/types';
import { api, apiUrl } from '@/shared/api/client';
import { clearSession, getStoredSession, storeSession } from '../model/session-storage';

export async function startDemoSession(nickname = '여행자'): Promise<LoginResponseDto> {
  const session = await api.post<LoginResponseDto>('/auth/demo', { nickname });
  storeSession(session);
  return session;
}

export function getKakaoStatus() {
  return api.get<KakaoAuthStatusDto>('/auth/kakao/status');
}

export function redirectToKakao() {
  window.location.href = apiUrl('/auth/kakao');
}

/** 서버에 refresh token 폐기 요청 + 로컬 세션 제거. 실패해도 로컬은 비운다. */
export async function logout(): Promise<void> {
  const session = getStoredSession();
  const refreshToken = session?.tokens.refreshToken;
  try {
    if (refreshToken) {
      await api.post('/auth/logout', { refreshToken });
    }
  } catch {
    // ignore — 어쨌든 로컬 세션은 비운다
  }
  clearSession();
}
