import type { ConfigService } from '@nestjs/config';
import { redisConnection } from '../../src/common/redis.config';

/** 최소 ConfigService 스텁 — get(key, default) 만 흉내낸다. */
const stubConfig = (env: Record<string, string | number | undefined>): ConfigService =>
  ({
    get: (key: string, def?: unknown) => (key in env ? env[key] : def),
  }) as unknown as ConfigService;

describe('redisConnection', () => {
  it('REDIS_URL(rediss) 이면 host·port·비밀번호·TLS 를 파싱한다', () => {
    const opts = redisConnection(stubConfig({ REDIS_URL: 'rediss://default:s3cret@my-host:6380' }));
    expect(opts).toMatchObject({
      host: 'my-host',
      port: 6380,
      username: 'default',
      password: 's3cret',
      tls: {},
    });
  });

  it('평문 redis:// 이면 TLS·비밀번호 없이 host·port 만 채운다', () => {
    const opts = redisConnection(stubConfig({ REDIS_URL: 'redis://plain-host:6379' }));
    expect(opts.host).toBe('plain-host');
    expect(opts.port).toBe(6379);
    expect(opts.username).toBeUndefined();
    expect(opts.password).toBeUndefined();
    expect(opts.tls).toBeUndefined();
  });

  it('REDIS_URL 이 없으면 REDIS_HOST/REDIS_PORT 로 폴백한다', () => {
    const opts = redisConnection(stubConfig({ REDIS_HOST: 'localhost', REDIS_PORT: 6379 }));
    expect(opts).toMatchObject({ host: 'localhost', port: 6379 });
    expect(opts.tls).toBeUndefined();
  });

  it('아무 것도 없으면 localhost:6379 기본값을 쓴다', () => {
    const opts = redisConnection(stubConfig({}));
    expect(opts).toMatchObject({ host: 'localhost', port: 6379 });
  });

  it('extra 옵션을 병합한다 (인스턴스별 lazyConnect 등)', () => {
    const opts = redisConnection(stubConfig({ REDIS_URL: 'redis://h:6379' }), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    expect(opts).toMatchObject({
      host: 'h',
      port: 6379,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  });
});
