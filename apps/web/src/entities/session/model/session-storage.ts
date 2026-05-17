import type { LoginResponseDto } from '@tripick/types';
import { readJson, removeStored, writeJson } from '@/shared/lib/storage';

const SESSION_KEY = 'tripick.session.v1';

export type Session = LoginResponseDto;

export function getStoredSession(): Session | null {
  return readJson<Session>(SESSION_KEY);
}

export function storeSession(session: Session): void {
  writeJson(SESSION_KEY, session);
}

export function clearSession(): void {
  removeStored(SESSION_KEY);
}
