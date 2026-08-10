/// <reference types="jest" />

import type { ConfigService } from '@nestjs/config';
import { accessTokenSecret, refreshTokenSecret } from '../../src/common/jwt-secrets';

function config(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('jwt secrets', () => {
  it('falls back to a dev secret outside production', () => {
    expect(accessTokenSecret(config())).toBe('tripick-demo-jwt-secret');
    expect(refreshTokenSecret(config())).toBe('tripick-demo-refresh-secret');
  });

  it('uses the configured secret when present', () => {
    const cfg = config({ JWT_SECRET: 'real-access', JWT_REFRESH_SECRET: 'real-refresh' });
    expect(accessTokenSecret(cfg)).toBe('real-access');
    expect(refreshTokenSecret(cfg)).toBe('real-refresh');
  });

  // env 하나가 빠진 채 뜨면 레포에 적힌 문자열로 서명하게 되고 토큰 위조가 열린다.
  it('refuses to boot in production without a secret', () => {
    const cfg = config({ NODE_ENV: 'production' });
    expect(() => accessTokenSecret(cfg)).toThrow(/JWT_SECRET/);
    expect(() => refreshTokenSecret(cfg)).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('refuses publicly known placeholder secrets in production', () => {
    expect(() =>
      accessTokenSecret(config({ NODE_ENV: 'production', JWT_SECRET: 'change-me-in-production' })),
    ).toThrow(/공개된 예시 값/);
    expect(() =>
      refreshTokenSecret(
        config({ NODE_ENV: 'production', JWT_REFRESH_SECRET: 'tripick-demo-refresh-secret' }),
      ),
    ).toThrow(/공개된 예시 값/);
  });

  it('accepts a real secret in production', () => {
    const cfg = config({ NODE_ENV: 'production', JWT_SECRET: '  s3cret-key  ' });
    expect(accessTokenSecret(cfg)).toBe('s3cret-key');
  });
});
