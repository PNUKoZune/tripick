import { ConfigService } from '@nestjs/config';

/**
 * JWT 서명 키를 한 곳에서 해석한다. 서명(AuthModule·AuthService)과 검증(JwtStrategy)이
 * 같은 값을 쓰도록 묶고, 프로덕션에서 키가 없거나 공개된 placeholder 면 부팅을 막는다.
 *
 * 폴백을 그대로 두면 env 하나가 빠졌을 때 레포에 적힌 문자열로 서명하게 되고,
 * 그 순간 누구나 임의 userId 로 토큰을 위조할 수 있다 — 조용히 넘어가면 안 되는 실패다.
 * 개발에서는 지금까지처럼 폴백으로 그냥 뜬다.
 */
const DEV_ACCESS_SECRET = 'tripick-demo-jwt-secret';
const DEV_REFRESH_SECRET = 'tripick-demo-refresh-secret';

/** 레포·문서에 노출돼 있어 프로덕션에서 쓰면 안 되는 값들 */
const PUBLICLY_KNOWN_SECRETS = new Set([
  DEV_ACCESS_SECRET,
  DEV_REFRESH_SECRET,
  'change-me-in-production',
  'change-me-refresh-in-production',
]);

export function accessTokenSecret(config: ConfigService): string {
  return resolveSecret(config, 'JWT_SECRET', DEV_ACCESS_SECRET);
}

export function refreshTokenSecret(config: ConfigService): string {
  return resolveSecret(config, 'JWT_REFRESH_SECRET', DEV_REFRESH_SECRET);
}

function resolveSecret(config: ConfigService, key: string, devFallback: string): string {
  const configured = config.get<string>(key)?.trim();
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  if (!configured) {
    if (isProduction) {
      throw new Error(`${key} 가 설정되지 않았습니다. 프로덕션에서는 반드시 지정해야 합니다.`);
    }
    return devFallback;
  }
  if (isProduction && PUBLICLY_KNOWN_SECRETS.has(configured)) {
    throw new Error(`${key} 가 공개된 예시 값입니다. 프로덕션 전용 키로 교체해주세요.`);
  }
  return configured;
}
