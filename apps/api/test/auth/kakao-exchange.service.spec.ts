/// <reference types="jest" />

import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { KakaoProfile, LoginResponseDto } from '@tripick/types';
import { KakaoExchangeService } from '../../src/auth/kakao-exchange.service';

const config = { get: () => undefined } as unknown as ConfigService;

/** 로그인을 시작한 브라우저가 들고 있는 bind 비밀(32바이트 base64url 형태). */
const BIND = 'bind-secret-that-is-long-enough-000000000000';
const OTHER_BIND = 'someone-elses-secret-of-the-same-shape-0000';

const SESSION: LoginResponseDto = {
  tokens: { accessToken: 'access', refreshToken: 'refresh' },
  user: { id: 'u1', nickname: '앨리스', emailVerified: true, hasPassword: true },
};

const PROFILE: KakaoProfile = { id: '77', nickname: '카카오', email: 'a@b.com' };

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
    const code = await service.issue(SESSION, BIND);

    expect(code).toEqual(expect.any(String));
    expect(code.length).toBeGreaterThanOrEqual(32);
    expect(code).not.toContain('refresh');
    expect(code).not.toContain('access');
  });

  it('exchanges the code back into the session', async () => {
    const { service } = createService();
    const code = await service.issue(SESSION, BIND);
    await expect(service.consume(code, BIND)).resolves.toEqual(SESSION);
  });

  // 이게 없으면 교환 코드는 URL 에 실린 그 자체로 세션이다 — 공격자가 자기 로그인으로 얻은
  // 코드를 피해자에게 링크·딥링크로 던져 피해자를 공격자 계정에 로그인시킬 수 있다.
  it('refuses a code presented by a browser that did not start the login', async () => {
    const { service } = createService();
    const code = await service.issue(SESSION, BIND);
    await expect(service.consume(code, OTHER_BIND)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a code presented with no bind at all', async () => {
    const { service } = createService();
    const code = await service.issue(SESSION, BIND);
    await expect(service.consume(code, '')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // bind 불일치로 거절된 코드를 남겨 두면, 공격자가 피해자에게 던져 실패시킨 뒤
  // 자기가 다시 쓰는 재시도 창이 열린다. 틀려도 코드는 소비돼야 한다.
  it('burns the code even when bind does not match', async () => {
    const { service } = createService();
    const code = await service.issue(SESSION, BIND);
    await expect(service.consume(code, OTHER_BIND)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.consume(code, BIND)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // Redis 를 읽을 수 있는 쪽에도 원본을 남기지 않는다.
  it('stores only a hash of the bind secret', async () => {
    const { service, redis } = createService();
    await service.issue(SESSION, BIND);
    const stored = redis.set.mock.calls[0]?.[1] as string;
    expect(stored).not.toContain(BIND);
  });

  // URL 에 남은 코드가 재사용되면 프래그먼트에 세션을 싣던 예전과 다를 게 없다.
  it('refuses to hand the same code out twice', async () => {
    const { service } = createService();
    const code = await service.issue(SESSION, BIND);
    await service.consume(code, BIND);
    await expect(service.consume(code, BIND)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an empty code without touching redis', async () => {
    const { service, redis } = createService();
    await expect(service.consume('', BIND)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('sets a short TTL so a leaked URL goes stale fast', async () => {
    const { service, redis } = createService();
    await service.issue(SESSION, BIND);
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

/**
 * 신규 가입자는 약관 동의 전까지 계정이 없다. 그동안 카카오 프로필을 들고 있는 대기표는
 * 세션 코드와 **다른 통**에 있어야 한다 — 한 통이면 가입 대기표로 세션 교환을 시도하는
 * 경로가 데이터가 아니라 코드 분기로만 갈린다.
 */
describe('KakaoExchangeService — 가입 대기표', () => {
  it('hands the kakao profile back to the browser that started the login', async () => {
    const { service } = createService();
    const ticket = await service.issueSignupTicket(PROFILE, BIND);
    await expect(service.consumeSignupTicket(ticket, BIND)).resolves.toEqual(PROFILE);
  });

  it('refuses a ticket presented by another browser, and burns it', async () => {
    const { service } = createService();
    const ticket = await service.issueSignupTicket(PROFILE, BIND);
    await expect(service.consumeSignupTicket(ticket, OTHER_BIND)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.consumeSignupTicket(ticket, BIND)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('cannot be spent as a session code, and vice versa', async () => {
    const { service } = createService();
    const ticket = await service.issueSignupTicket(PROFILE, BIND);
    await expect(service.consume(ticket, BIND)).rejects.toBeInstanceOf(UnauthorizedException);

    const code = await service.issue(SESSION, BIND);
    await expect(service.consumeSignupTicket(code, BIND)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('is single use', async () => {
    const { service } = createService();
    const ticket = await service.issueSignupTicket(PROFILE, BIND);
    await service.consumeSignupTicket(ticket, BIND);
    await expect(service.consumeSignupTicket(ticket, BIND)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // 사람이 약관을 읽는 시간은 필요하지만, 인증만 통과한 프로필이 오래 떠 있을 이유도 없다.
  it('lives long enough to read the terms but not forever', async () => {
    const { service, redis } = createService();
    await service.issueSignupTicket(PROFILE, BIND);
    const ttl = redis.set.mock.calls[0]?.[3] as number;
    expect(ttl).toBeGreaterThanOrEqual(300);
    expect(ttl).toBeLessThanOrEqual(900);
  });
});
