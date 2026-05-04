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
export interface LoginResponseDto {
    tokens: AuthTokens;
    user: {
        id: string;
        nickname: string;
        profileImageUrl?: string;
    };
}
//# sourceMappingURL=auth.d.ts.map