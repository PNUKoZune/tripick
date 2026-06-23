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

export interface DemoLoginDto {
  nickname?: string;
}

export interface KakaoAuthStatusDto {
  ready: boolean;
  authorizeUrl?: string;
  missingKeys?: string[];
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
