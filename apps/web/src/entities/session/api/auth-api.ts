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
import { isNativeShell, requestNativeRefreshToken } from '@/shared/rn-bridge/native-refresh-token';
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

// ─── 카카오 ────────────────────────────────────────────────

export function getKakaoStatus() {
  return api.get<KakaoAuthStatusDto>('/auth/kakao/status');
}

/**
 * 카카오 로그인 시작. 서버가 준 절대 `startUrl` 로 이동한다 — 상대경로로 가면 웹 프록시
 * 오리진에서 출발하는데 카카오는 API 오리진으로 돌려보내, 시작 때 심은 CSRF state 쿠키가
 * 콜백에 실리지 않아 로그인이 항상 실패한다.
 */
export async function redirectToKakao(): Promise<void> {
  const status = await getKakaoStatus();
  if (!status.ready || !status.startUrl) {
    throw new Error(
      status.missingKeys?.length
        ? `카카오 로그인 환경 변수가 필요해요: ${status.missingKeys.join(', ')}`
        : '카카오 로그인을 시작하지 못했습니다.',
    );
  }
  window.location.href = status.startUrl;
}

/** 콜백 URL 의 1회용 코드를 실제 세션으로 바꾼다. 코드는 서버에서 즉시 소비된다. */
export async function exchangeKakaoCode(code: string): Promise<LoginResponseDto> {
  const session = await api.post<LoginResponseDto>('/auth/kakao/exchange', { code });
  storeSession(session);
  void flushPendingFcmToken();
  return session;
}

// ─── 세션 종료 / 토큰 갱신 ───────────────────────────────────

/**
 * 서버 호출 없이 이 기기의 흔적만 지운다. 탈퇴처럼 **서버 쪽이 이미 정리된** 경우에 쓴다 —
 * 그때 `logout()` 을 부르면 삭제된 계정으로 FCM 해제·refresh 폐기 요청이 나가 401 을 맞고,
 * 클라이언트가 다시 refresh 를 시도하는 헛된 왕복이 세 번 돈다.
 */
export function clearLocalSession(): void {
  clearLastFcmToken();
  clearSession();
}

/** 서버에 refresh token 폐기 요청 + 로컬 세션 제거. 실패해도 로컬은 비운다. */
export async function logout(): Promise<void> {
  const session = getStoredSession();
  // RN 웹뷰에선 refresh 가 네이티브 SecureStore 에 있어 브리지로 가져와 서버에 폐기 요청한다.
  const refreshToken = isNativeShell()
    ? await requestNativeRefreshToken()
    : session?.tokens.refreshToken;

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
  // RN 웹뷰에선 refresh 가 네이티브 SecureStore 에 있어 브리지로 가져온다.
  const refreshToken = isNativeShell()
    ? await requestNativeRefreshToken()
    : session.tokens.refreshToken;
  // undefined = 브리지 순단(판정 불가) → 세션 보존하고 다음 기회에 재시도.
  if (refreshToken === undefined) return null;
  // null/'' = 토큰 확정 부재 → 세션 소실이라 로컬도 비운다.
  if (!refreshToken) {
    clearSession('expired');
    return null;
  }
  try {
    const tokens = await api.post<AuthTokens>('/auth/refresh', { refreshToken });
    storeSession({ ...session, tokens });
    return tokens;
  } catch {
    // refresh 실패 = 로그인 만료. 로컬 세션 비움.
    clearSession('expired');
    return null;
  }
}
