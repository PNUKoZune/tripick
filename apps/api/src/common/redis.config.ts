import type { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

/**
 * Redis 접속 옵션을 한 곳에서 만든다.
 *
 * 우선순위:
 *   1. REDIS_URL — 매니지드 Redis(Railway 등)가 주는 비밀번호·TLS 포함 URL.
 *      `rediss://` 이면 TLS 를 켠다.
 *   2. REDIS_HOST / REDIS_PORT — 로컬 docker-compose.
 *
 * BullMQ connection, ThrottlerStorageRedisService, 각 서비스의 ioredis 인스턴스가
 * 모두 이 함수를 거쳐 동일한 접속 정보를 쓴다. 인스턴스별 추가 옵션
 * (lazyConnect·maxRetriesPerRequest 등)은 `extra` 로 덮어쓴다.
 */
export function redisConnection(config: ConfigService, extra: RedisOptions = {}): RedisOptions {
  const url = config.get<string>('REDIS_URL');

  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
      ...extra,
    };
  }

  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: config.get<number>('REDIS_PORT', 6379),
    ...extra,
  };
}
