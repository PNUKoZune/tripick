import type {
  AuthOpResultDto,
  AuthTokens,
  EmailLoginDto,
  EmailSignupDto,
  KakaoAuthStatusDto,
  LoginResponseDto,
} from '@tripick/types';
import { api, apiUrl } from '@/shared/api/client';
import { deleteFcmToken, flushPendingFcmToken } from '@/entities/user';
import { clearLastFcmToken, getLastFcmToken } from '@/shared/rn-bridge/fcm-token-storage';
import { clearSession, getStoredSession, storeSession } from '../model/session-storage';

// ─── 이메일 가입 / 로그인 / 인증 / 재설정 ─────────────────────

export async function signupWithEmail(dto: EmailSignupDto): Promise<AuthOpResultDto> {
  return api.post<AuthOpResultDto>('/auth/signup', dto);
}

export async function loginWithEmail(dto: EmailLoginDto): Promise<LoginResponseDto> {
  const session = await api.post<LoginResponseDto>('/auth/login', dto);
  storeSession(session);
  void flushPendingFcmToken();
  return session;
}

export function verifyEmail(token: string) {
  return api.post<AuthOpResultDto>('/auth/verify-email', { token });
}

export function resendVerification(email: string) {
  return api.post<AuthOpResultDto>('/auth/resend-verification', { email });
}

export function requestPasswordReset(email: string) {
  return api.post<AuthOpResultDto>('/auth/forgot-password', { email });
}

export function resetPassword(token: string, password: string) {
  return api.post<AuthOpResultDto>('/auth/reset-password', { token, password });
}

// ─── 데모 / 카카오 ─────────────────────────────────────────

export async function startDemoSession(nickname = '여행자'): Promise<LoginResponseDto> {
  const session = await api.post<LoginResponseDto>('/auth/demo', { nickname });
  storeSession(session);
  void flushPendingFcmToken();
  return session;
}

export function getKakaoStatus() {
  return api.get<KakaoAuthStatusDto>('/auth/kakao/status');
}

export function redirectToKakao() {
  window.location.href = apiUrl('/auth/kakao');
}

// ─── 세션 종료 / 토큰 갱신 ───────────────────────────────────

/** 서버에 refresh token 폐기 요청 + 로컬 세션 제거. 실패해도 로컬은 비운다. */
export async function logout(): Promise<void> {
  const session = getStoredSession();
  const refreshToken = session?.tokens.refreshToken;

  // 이 기기에 등록된 FCM 토큰을 먼저 해제한다(세션 제거 전이라 access token 유효).
  // 안 지우면 로그아웃한 기기가 이전 사용자 앞으로 오는 푸시를 계속 받는다.
  const fcmToken = getLastFcmToken();
  if (fcmToken) {
    try {
      await deleteFcmToken(fcmToken);
    } catch {
      // best-effort — 실패해도 로그아웃은 진행
    }
    clearLastFcmToken();
  }

  try {
    if (refreshToken) {
      await api.post('/auth/logout', { refreshToken });
    }
  } catch {
    // ignore — 어쨌든 로컬 세션은 비운다
  }
  clearSession();
}

/** access token 만료 시 호출. rotation 적용 — 새 refresh token 도 같이 저장. */
export async function refreshTokens(): Promise<AuthTokens | null> {
  const session = getStoredSession();
  if (!session) return null;
  try {
    const tokens = await api.post<AuthTokens>('/auth/refresh', {
      refreshToken: session.tokens.refreshToken,
    });
    storeSession({ ...session, tokens });
    return tokens;
  } catch {
    // refresh 실패 = 로그인 만료. 로컬 세션 비움.
    clearSession();
    return null;
  }
}
