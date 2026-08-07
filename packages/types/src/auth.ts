export interface KakaoProfile {
  id: string;
  nickname: string;
  profileImageUrl?: string;
  email?: string;
}

export interface JwtPayload {
  sub: string;
  email?: string;
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SessionUserDto {
  id: string;
  nickname: string;
  /** 친구 추가·멘션용 고유 핸들 (예: "koty"). 가입 경로와 무관하게 항상 존재. */
  handle?: string;
  profileImageUrl?: string;
  email?: string;
  emailVerified: boolean;
  hasPassword: boolean;
  isDemo: boolean;
}

export interface LoginResponseDto {
  tokens: AuthTokens;
  user: SessionUserDto;
}

export interface KakaoAuthStatusDto {
  ready: boolean;
  missingKeys?: string[];
  /**
   * 로그인을 시작할 절대 URL. 상대경로(`/api/v1/auth/kakao`)로 시작하면 웹 프록시 오리진에서
   * 출발하는데 카카오는 `KAKAO_CALLBACK_URL`(API 오리진)로 돌려보내, 시작 때 심은 CSRF state
   * 쿠키가 콜백에 실리지 않는다. 두 다리를 같은 오리진에 두려고 서버가 계산해서 내려준다.
   */
  startUrl?: string;
}

/** 카카오 콜백이 URL 로 넘긴 1회용 교환 코드 → 실제 세션. */
export interface KakaoExchangeDto {
  code: string;
}

export interface EmailSignupDto {
  email: string;
  password: string;
  nickname: string;
}

export interface EmailLoginDto {
  email: string;
  password: string;
}

export interface VerifyEmailDto {
  token: string;
}

export interface ResendVerificationDto {
  email: string;
}

export interface RequestPasswordResetDto {
  email: string;
}

export interface ResetPasswordDto {
  token: string;
  password: string;
}

/** /auth/signup, /auth/verify-email 등 비-로그인 응답 — message + email 정도만 노출 */
export interface AuthOpResultDto {
  ok: true;
  message: string;
  /** 디버그·UI 안내용 — 인증 메일을 보낸 주소 등 */
  email?: string;
}
