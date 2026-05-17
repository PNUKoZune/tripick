import type { KakaoAuthStatusDto, LoginResponseDto } from '@tripick/types';
import { api, apiUrl } from '@/shared/api/client';
import { storeSession } from '../model/session-storage';

export async function startDemoSession(nickname = '고태영'): Promise<LoginResponseDto> {
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
