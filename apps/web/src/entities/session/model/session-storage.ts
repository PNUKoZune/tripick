import type { LoginResponseDto } from '@tripick/types';
import { readJson } from '@/shared/lib/storage';
import {
  clearStoredSession,
  persistSession,
  SESSION_STORAGE_KEY,
} from '@/shared/lib/session-token';

export type Session = LoginResponseDto;

export function getStoredSession(): Session | null {
  return readJson<Session>(SESSION_STORAGE_KEY);
}

export function storeSession(session: Session): void {
  // RN 웹뷰에선 refresh 를 네이티브 SecureStore 로 넘기고 localStorage 엔 access 만 남긴다.
  persistSession(session);
}

export function clearSession(): void {
  clearStoredSession();
}
