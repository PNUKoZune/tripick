/// <reference types="jest" />

import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { LoginResponseDto } from '@tripick/types';
import { KakaoExchangeService } from '../../src/auth/kakao-exchange.service';

const config = { get: () => undefined } as unknown as ConfigService;

const SESSION: LoginResponseDto = {
  tokens: { accessToken: 'access', refreshToken: 'refresh' },
  user: { id: 'u1', nickname: '앨리스', emailVerified: true, hasPassword: true },
};

/** GETDEL 시맨틱만 흉내내는 최소 Redis 스텁. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn(async (key: string, value: string, ..._rest: unknown[]) => {
      store.set(key, value);
    }),
    getdel: jest.fn(async (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    }),
    on: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
}

function createService() {
  const service = new KakaoExchangeService(config);
  const redis = fakeRedis();
  (service as unknown as { redis: unknown }).redis = redis;
  return { service, redis };
}

describe('KakaoExchangeService', () => {
  it('issues an opaque code and never puts tokens in it', async () => {
    const { service } = createService();
    const code = await service.issue(SESSION);

    expect(code).toEqual(expect.any(String));
    expect(code.length).toBeGreaterThanOrEqual(32);
    expect(code).not.toContain('refresh');
    expect(code).not.toContain('access');
  });

  it('exchanges the code back into the session', async () => {
    const { service } = createService();
    const code = await service.issue(SESSION);
    await expect(service.consume(code)).resolves.toEqual(SESSION);
  });

  // URL 에 남은 코드가 재사용되면 프래그먼트에 세션을 싣던 예전과 다를 게 없다.
  it('refuses to hand the same code out twice', async () => {
    const { service } = createService();
    const code = await service.issue(SESSION);
    await service.consume(code);
    await expect(service.consume(code)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an empty code without touching redis', async () => {
    const { service, redis } = createService();
    await expect(service.consume('')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('sets a short TTL so a leaked URL goes stale fast', async () => {
    const { service, redis } = createService();
    await service.issue(SESSION);
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'EX',
      expect.any(Number),
    );
    const ttl = redis.set.mock.calls[0]?.[3];
    expect(typeof ttl).toBe('number');
    expect(ttl as number).toBeLessThanOrEqual(300);
  });
});
