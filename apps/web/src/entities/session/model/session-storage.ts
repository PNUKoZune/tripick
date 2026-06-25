import type { LoginResponseDto } from '@tripick/types';
import { readJson, writeJson } from '@/shared/lib/storage';
import { clearStoredSession, SESSION_STORAGE_KEY } from '@/shared/lib/session-token';

export type Session = LoginResponseDto;

export function getStoredSession(): Session | null {
  return readJson<Session>(SESSION_STORAGE_KEY);
}

export function storeSession(session: Session): void {
  writeJson(SESSION_STORAGE_KEY, session);
}

export function clearSession(): void {
  clearStoredSession();
}
