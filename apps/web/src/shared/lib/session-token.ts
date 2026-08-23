import type { AuthTokens, LoginResponseDto } from '@tripick/types';
import {
  clearNativeRefreshToken,
  isNativeShell,
  storeNativeRefreshToken,
} from '@/shared/rn-bridge/native-refresh-token';
import { readJson, removeStored, writeJson } from './storage';

/**
 * 세션(토큰 포함)이 저장되는 단일 localStorage 키.
 * entities/session 모델과 shared/api 클라이언트가 함께 참조해 키/구조 drift 를 막는다.
 */
export const SESSION_STORAGE_KEY = 'tripick.session.v1';

/**
 * 세션이 끝난 사유. 안내 문구를 가르는 값이라 "만료(사용자가 한 일이 아님)" 와
 * "로그아웃·탈퇴(사용자가 한 일)" 만 구분한다.
 */
export type SessionEndReason = 'expired' | 'signed-out';

/** 마지막으로 세션이 끝난 사유. 리다이렉트를 건너 읽혀야 해서 sessionStorage 에 남긴다. */
const SESSION_END_KEY = 'tripick.session-end.v1';
/**
 * 사유의 유통기한. 가드가 안 도는 화면(랜딩 등)에서 세션이 끝나면 마커만 남는데,
 * 그게 몇 시간 뒤 보호 화면 진입에서 소비되면 "로그인이 만료됐어요" 가 뜬금없이 뜬다.
 */
const SESSION_END_TTL_MS = 60_000;

export function getAccessToken(): string | null {
  return readJson<LoginResponseDto>(SESSION_STORAGE_KEY)?.tokens?.accessToken ?? null;
}

/**
 * localStorage 에 남은 refresh 토큰. RN 웹뷰에선 refresh 를 네이티브 SecureStore 로 옮기고
 * localStorage 에는 비워 두므로 여기선 null 이 나온다(그쪽은 `requestNativeRefreshToken` 사용).
 */
export function getRefreshToken(): string | null {
  return readJson<LoginResponseDto>(SESSION_STORAGE_KEY)?.tokens?.refreshToken || null;
}

/**
 * 세션을 저장한다. RN 웹뷰에선 refresh 토큰을 네이티브 SecureStore 로 넘기고
 * localStorage 에는 access 만(refresh 는 빈 문자열) 남긴다. 브라우저 단독이면 전체를 저장한다.
 */
export function persistSession(session: LoginResponseDto): void {
  if (isNativeShell()) {
    const refreshToken = session.tokens?.refreshToken;
    if (refreshToken) storeNativeRefreshToken(refreshToken);
    writeJson(SESSION_STORAGE_KEY, stripRefreshToken(session));
  } else {
    writeJson(SESSION_STORAGE_KEY, session);
  }
  // 로그인했으니 이전 종료 사유는 무효 — 안 지우면 다음 리다이렉트에서 지난 만료가 되살아난다.
  discardSessionEnd();
  emitSessionChange();
}

/** 저장된 세션의 토큰만 새 값으로 교체(토큰 회전). 세션이 없으면 아무것도 하지 않는다. */
export function replaceTokens(tokens: AuthTokens): void {
  const session = readJson<LoginResponseDto>(SESSION_STORAGE_KEY);
  if (!session) return;
  persistSession({ ...session, tokens });
}

export function clearStoredSession(reason: SessionEndReason = 'signed-out'): void {
  if (isNativeShell()) clearNativeRefreshToken();
  removeStored(SESSION_STORAGE_KEY);
  markSessionEnd(reason);
  emitSessionChange();
}

function markSessionEnd(reason: SessionEndReason): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_END_KEY, JSON.stringify({ reason, at: Date.now() }));
  } catch {
    // storage 차단 환경 — 사유 없이 기본 문구로 안내된다.
  }
}

function discardSessionEnd(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_END_KEY);
  } catch {
    // storage 차단 환경 — 마커 자체가 안 남아 있으니 무시해도 된다.
  }
}

/**
 * 마지막 세션 종료 사유를 **꺼내며 지운다**(1회성). 유통기한이 지났거나 없으면 null.
 * 지우지 않으면 다음 로그아웃까지 같은 사유가 계속 재사용된다.
 */
export function takeSessionEndReason(): SessionEndReason | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(SESSION_END_KEY);
    window.sessionStorage.removeItem(SESSION_END_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { reason?: SessionEndReason; at?: number };
    if (parsed.reason !== 'expired' && parsed.reason !== 'signed-out') return null;
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > SESSION_END_TTL_MS) return null;
    return parsed.reason;
  } catch {
    return null;
  }
}

const sessionListeners = new Set<() => void>();

/**
 * 세션 유무 변화 구독. localStorage 는 같은 탭의 쓰기로 `storage` 이벤트를 쏘지 않으므로
 * 저장·삭제 지점에서 직접 알린다(다른 탭발 변화는 `storage` 로 받는다).
 */
export function subscribeSessionChange(listener: () => void): () => void {
  sessionListeners.add(listener);
  if (typeof window !== 'undefined' && sessionListeners.size === 1) {
    window.addEventListener('storage', handleStorageEvent);
  }
  return () => {
    sessionListeners.delete(listener);
    if (typeof window !== 'undefined' && sessionListeners.size === 0) {
      window.removeEventListener('storage', handleStorageEvent);
    }
  };
}

function emitSessionChange(): void {
  for (const listener of sessionListeners) listener();
}

function handleStorageEvent(event: StorageEvent): void {
  // key === null 은 storage.clear() — 세션도 같이 날아갔다고 본다.
  if (event.key === SESSION_STORAGE_KEY || event.key === null) emitSessionChange();
}

/** refresh 토큰을 비운 세션 사본. localStorage 에 refresh 를 영속하지 않기 위함. */
function stripRefreshToken(session: LoginResponseDto): LoginResponseDto {
  return { ...session, tokens: { ...session.tokens, refreshToken: '' } };
}
