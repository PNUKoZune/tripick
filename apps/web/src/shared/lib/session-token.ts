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
    return;
  }
  writeJson(SESSION_STORAGE_KEY, session);
}

/** 저장된 세션의 토큰만 새 값으로 교체(토큰 회전). 세션이 없으면 아무것도 하지 않는다. */
export function replaceTokens(tokens: AuthTokens): void {
  const session = readJson<LoginResponseDto>(SESSION_STORAGE_KEY);
  if (!session) return;
  persistSession({ ...session, tokens });
}

export function clearStoredSession(): void {
  if (isNativeShell()) clearNativeRefreshToken();
  removeStored(SESSION_STORAGE_KEY);
}

/** refresh 토큰을 비운 세션 사본. localStorage 에 refresh 를 영속하지 않기 위함. */
function stripRefreshToken(session: LoginResponseDto): LoginResponseDto {
  return { ...session, tokens: { ...session.tokens, refreshToken: '' } };
}
