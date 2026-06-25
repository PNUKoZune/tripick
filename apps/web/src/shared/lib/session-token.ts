import type { AuthTokens, LoginResponseDto } from '@tripick/types';
import { readJson, removeStored, writeJson } from './storage';

/**
 * 세션(토큰 포함)이 저장되는 단일 localStorage 키.
 * entities/session 모델과 shared/api 클라이언트가 함께 참조해 키/구조 drift 를 막는다.
 */
export const SESSION_STORAGE_KEY = 'tripick.session.v1';

export function getAccessToken(): string | null {
  return readJson<LoginResponseDto>(SESSION_STORAGE_KEY)?.tokens?.accessToken ?? null;
}

export function getRefreshToken(): string | null {
  return readJson<LoginResponseDto>(SESSION_STORAGE_KEY)?.tokens?.refreshToken ?? null;
}

/** 저장된 세션의 토큰만 새 값으로 교체. 세션이 없으면 아무것도 하지 않는다. */
export function replaceTokens(tokens: AuthTokens): void {
  const session = readJson<LoginResponseDto>(SESSION_STORAGE_KEY);
  if (!session) return;
  writeJson(SESSION_STORAGE_KEY, { ...session, tokens });
}

export function clearStoredSession(): void {
  removeStored(SESSION_STORAGE_KEY);
}
