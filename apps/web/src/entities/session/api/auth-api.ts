import type {
  AuthOpResultDto,
  AuthTokens,
  ChangePasswordDto,
  EmailLoginDto,
  EmailSignupDto,
  KakaoAuthStatusDto,
  KakaoExchangeResultDto,
  LoginResponseDto,
} from '@tripick/types';
import { api, apiUrl } from '@/shared/api/client';
import { deleteFcmToken, flushPendingFcmToken } from '@/entities/user';
import { clearLastFcmToken, getLastFcmToken } from '@/shared/rn-bridge/fcm-token-storage';
import { isNativeShell, requestNativeRefreshToken } from '@/shared/rn-bridge/native-refresh-token';
import { clearKakaoBind, readKakaoBind, startKakaoBind } from '../model/kakao-bind';
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

/**
 * 로그인 상태에서 비밀번호 변경. 서버가 다른 기기의 refresh 를 전부 끊고 이 기기 몫으로
 * 새 세션을 돌려주므로, 받은 즉시 저장해 갈아탄다 — 안 그러면 방금 폐기된 토큰을 들고 있다가
 * 다음 갱신에서 자기 세션만 만료된다.
 */
export async function changePassword(dto: ChangePasswordDto): Promise<LoginResponseDto> {
  const session = await api.post<LoginResponseDto>('/auth/change-password', dto);
  storeSession(session);
  return session;
}

// ─── 카카오 ────────────────────────────────────────────────

export function getKakaoStatus() {
  return api.get<KakaoAuthStatusDto>('/auth/kakao/status');
}

/** 앱 셸이 복귀를 처리할 수 있는 플랫폼인지. 둘 다 아니면(모르는 셸) 웹 복귀로 둔다. */
function nativeReturnTarget(userAgent: string): 'android' | 'ios' | null {
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  return null;
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
  const startUrl = new URL(status.startUrl);
  // 이 브라우저가 로그인을 시작했다는 증거. 서버가 해시를 교환 코드에 묶어, 남이 던진
  // 코드로는 세션이 안 나오게 한다 (로그인 CSRF 차단). 없으면 서버가 시작 자체를 거절한다.
  startUrl.searchParams.set('bind', startKakaoBind());
  // 앱에서 시작한 OAuth 는 서버가 최종 콜백을 앱으로 되돌린다 — Android 는 package 를 못박은
  // `intent://`(링크 열기 설정이 꺼져 있어도 복귀), iOS 는 셸의 인증 세션이 가로채는 `tripick://`.
  // 안 보내면 로그인은 브라우저에서 끝나고, 교환에 필요한 bind 는 앱 웹뷰에만 있어 실패한다.
  const nativeTarget = isNativeShell() ? nativeReturnTarget(navigator.userAgent) : null;
  if (nativeTarget) {
    startUrl.searchParams.set('returnTo', nativeTarget);
  }
  window.location.href = startUrl.toString();
}

/**
 * 콜백 URL 의 1회용 코드를 교환한다. 코드는 서버에서 즉시 소비된다.
 *
 * 시작 때 보관한 bind 비밀을 같이 제시한다 — 서버가 코드에 실린 해시와 대조하므로,
 * 남이 링크·딥링크로 던진 코드는 여기서 떨어진다.
 *
 * 기존 회원이면 세션이 바로 나오지만, **처음 오는 사람은 아직 계정이 없다** — 서버가
 * 약관 동의를 받아 오라며 `consent_required` 를 준다. 그 경우 bind 를 지우지 않는다:
 * 동의 후 {@link completeKakaoSignup} 이 같은 bind 로 한 번 더 서버를 불러야 한다.
 */
export async function exchangeKakaoCode(code: string): Promise<KakaoExchangeResultDto> {
  const bind = readKakaoBind();
  let keepBind = false;
  try {
    const result = await api.post<KakaoExchangeResultDto>('/auth/kakao/exchange', { code, bind });
    if (result.status === 'consent_required') {
      keepBind = true;
      return result;
    }
    storeSession(result.session);
    void flushPendingFcmToken();
    return result;
  } finally {
    if (!keepBind) clearKakaoBind();
  }
}

/** 약관 동의를 마친 카카오 신규 가입 완료. 여기서 비로소 계정이 만들어진다. */
export async function completeKakaoSignup(consentCode: string): Promise<LoginResponseDto> {
  const bind = readKakaoBind();
  try {
    const session = await api.post<LoginResponseDto>('/auth/kakao/signup', {
      code: consentCode,
      bind,
    });
    storeSession(session);
    void flushPendingFcmToken();
    return session;
  } finally {
    clearKakaoBind();
  }
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
