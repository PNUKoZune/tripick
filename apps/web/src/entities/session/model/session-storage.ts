import type { LoginResponseDto } from '@tripick/types';
import { readJson } from '@/shared/lib/storage';
import {
  clearStoredSession,
  persistSession,
  SESSION_STORAGE_KEY,
  type SessionEndReason,
} from '@/shared/lib/session-token';

export type Session = LoginResponseDto;

export function getStoredSession(): Session | null {
  return readJson<Session>(SESSION_STORAGE_KEY);
}

export function storeSession(session: Session): void {
  // RN 웹뷰에선 refresh 를 네이티브 SecureStore 로 넘기고 localStorage 엔 access 만 남긴다.
  persistSession(session);
}

/** 사유는 안내 문구를 가른다 — 만료면 'expired', 사용자가 끝낸 세션이면 기본값. */
export function clearSession(reason: SessionEndReason = 'signed-out'): void {
  clearStoredSession(reason);
}
