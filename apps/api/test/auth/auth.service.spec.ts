/// <reference types="jest" />

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { AuthService } from '../../src/auth/auth.service';
import { UserEntity } from '../../src/users/user.entity';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

function config(overrides: Record<string, string> = {}) {
  return {
    get: <T>(key: string, def?: T) => (key in overrides ? (overrides[key] as unknown as T) : def),
    getOrThrow: (key: string) => {
      if (!(key in overrides)) throw new Error(`missing ${key}`);
      return overrides[key];
    },
  } as any;
}

/** `.update().set().where().execute()` 체인을 흉내내는 QueryBuilder 스텁. */
function queryBuilder(execResult: { affected?: number } = { affected: 1 }) {
  const qb: any = {};
  qb.update = () => qb;
  qb.set = () => qb;
  qb.where = () => qb;
  qb.execute = jest.fn().mockResolvedValue(execResult);
  return qb;
}

function user(over: Partial<UserEntity> = {}): UserEntity {
  return { id: 'u1', nickname: '앨리스', isDemo: false, ...over } as UserEntity;
}

function createHarness(configOverrides: Record<string, string> = {}) {
  const usersService = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    createEmailUser: jest.fn(),
    markEmailVerified: jest.fn(),
    setPassword: jest.fn(),
    findOrCreateByKakao: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(async (payload: any, opts?: any) => `jwt(${payload.sub})${opts ? '-r' : ''}`),
    verify: jest.fn(),
  };
  const emailService = {
    sendVerification: jest.fn(),
    sendPasswordReset: jest.fn(),
    sendAccountExistsNotice: jest.fn(),
  };
  const refreshRepo = {
    create: jest.fn((v: any) => v),
    save: jest.fn(async (v: any) => ({ id: v.id ?? 'rt-1', ...v })),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => queryBuilder()),
  };
  const emailTokenRepo = {
    create: jest.fn((v: any) => v),
    save: jest.fn(async (v: any) => ({ id: v.id ?? 'et-1', ...v })),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => queryBuilder()),
  };
  const service = new AuthService(
    usersService as any,
    jwtService as any,
    config(configOverrides),
    emailService as any,
    refreshRepo as any,
    emailTokenRepo as any,
  );
  return { service, usersService, jwtService, emailService, refreshRepo, emailTokenRepo };
}

describe('AuthService — email signup', () => {
  it('rejects an invalid email format', async () => {
    const { service } = createHarness();
    await expect(
      service.signupWithEmail({ email: 'nope', password: 'abc12345', nickname: '앨리스' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a password without both letters and digits', async () => {
    const { service } = createHarness();
    await expect(
      service.signupWithEmail({ email: 'a@b.com', password: 'onlyletters', nickname: '앨리스' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an empty nickname', async () => {
    const { service } = createHarness();
    await expect(
      service.signupWithEmail({ email: 'a@b.com', password: 'abc12345', nickname: '  ' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // 예전엔 여기서 409 를 던져 "이 이메일 가입돼 있음"이 그대로 새어 나갔다.
  it('answers an existing account exactly like a fresh signup', async () => {
    const { service, usersService, emailService } = createHarness();
    usersService.findByEmail.mockResolvedValue(null);
    usersService.createEmailUser.mockResolvedValue(user({ email: 'a@b.com' }));
    const fresh = await service.signupWithEmail({
      email: 'a@b.com',
      password: 'abc12345',
      nickname: '앨리스',
    } as any);

    usersService.findByEmail.mockResolvedValue(user({ email: 'a@b.com', passwordHash: 'x' }));
    const taken = await service.signupWithEmail({
      email: 'a@b.com',
      password: 'abc12345',
      nickname: '앨리스',
    } as any);

    expect(taken).toEqual(fresh);
    expect(emailService.sendAccountExistsNotice).toHaveBeenCalledTimes(1);
  });

  it('creates a new email user and dispatches a verification mail', async () => {
    const { service, usersService, emailService } = createHarness();
    usersService.findByEmail.mockResolvedValue(null);
    usersService.createEmailUser.mockResolvedValue(user({ email: 'a@b.com' }));

    const res = await service.signupWithEmail({
      email: 'A@B.com',
      password: 'abc12345',
      nickname: '앨리스',
    } as any);

    expect(usersService.createEmailUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.com', nickname: '앨리스' }),
    );
    expect(emailService.sendVerification).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: true, email: 'a@b.com' });
  });

  /**
   * 계정 탈취 경로: 공격자가 피해자 이메일로 가입 → 피해자에게 "가입 인증" 메일 도착 →
   * 피해자가 누르는 순간 공격자 비밀번호가 활성화. 기존 계정은 손대지 않아야 한다.
   */
  it('never plants a password on an existing account', async () => {
    const { service, usersService, emailService } = createHarness();
    usersService.findByEmail.mockResolvedValue(user({ email: 'a@b.com' })); // 카카오 가입자(비밀번호 없음)

    await service.signupWithEmail({
      email: 'a@b.com',
      password: 'attacker1',
      nickname: '공격자',
    } as any);

    expect(usersService.createEmailUser).not.toHaveBeenCalled();
    expect(emailService.sendVerification).not.toHaveBeenCalled();
    expect(emailService.sendAccountExistsNotice).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService — email login', () => {
  it('throws 401 when the user does not exist', async () => {
    const { service, usersService } = createHarness();
    usersService.findByEmail.mockResolvedValue(null);
    await expect(
      service.loginWithEmail({ email: 'a@b.com', password: 'abc12345' } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 403 when the password is only pending verification', async () => {
    const { service, usersService } = createHarness();
    const pendingHash = await bcrypt.hash('abc12345', 10);
    usersService.findByEmail.mockResolvedValue(user({ pendingPasswordHash: pendingHash }));
    await expect(
      service.loginWithEmail({ email: 'a@b.com', password: 'abc12345' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws 401 on a wrong password', async () => {
    const { service, usersService } = createHarness();
    const hash = await bcrypt.hash('correct1', 10);
    usersService.findByEmail.mockResolvedValue(user({ passwordHash: hash }));
    await expect(
      service.loginWithEmail({ email: 'a@b.com', password: 'wrongone1' } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('issues tokens and a session user on success', async () => {
    const { service, usersService, refreshRepo } = createHarness();
    const hash = await bcrypt.hash('correct1', 10);
    usersService.findByEmail.mockResolvedValue(user({ id: 'u9', passwordHash: hash, email: 'a@b.com' }));

    const res = await service.loginWithEmail({ email: 'a@b.com', password: 'correct1' } as any);

    expect(res.tokens.accessToken).toContain('u9');
    expect(res.tokens.refreshToken).toBeTruthy();
    expect(res.user).toMatchObject({ id: 'u9', hasPassword: true });
    // 최초 발급은 familyId 확정을 위해 2번 저장한다.
    expect(refreshRepo.save).toHaveBeenCalledTimes(2);
  });
});

describe('AuthService — refresh rotation', () => {
  const REFRESH = 'refresh-token-value';

  function activeRow(over: Record<string, any> = {}) {
    return {
      id: 'rt-1',
      userId: 'u1',
      familyId: 'fam-1',
      tokenHash: sha256(REFRESH),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      replacedAt: null,
      ...over,
    };
  }

  it('rejects an empty token', async () => {
    const { service } = createHarness();
    await expect(service.refreshTokens('')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token that fails JWT verification', async () => {
    const { service, jwtService } = createHarness();
    jwtService.verify.mockImplementation(() => {
      throw new Error('bad');
    });
    await expect(service.refreshTokens(REFRESH)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes all tokens when a valid JWT has no DB row (forgery/rotation gap)', async () => {
    const { service, jwtService, refreshRepo } = createHarness();
    jwtService.verify.mockReturnValue({ sub: 'u1' });
    refreshRepo.findOne.mockResolvedValue(null);
    const qb = queryBuilder();
    refreshRepo.createQueryBuilder.mockReturnValue(qb);

    await expect(service.refreshTokens(REFRESH)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(qb.execute).toHaveBeenCalled(); // revokeAll 실행
  });

  it('detects reuse of a long-rotated token and revokes the family', async () => {
    const { service, jwtService, refreshRepo } = createHarness();
    jwtService.verify.mockReturnValue({ sub: 'u1' });
    refreshRepo.findOne.mockResolvedValue(
      activeRow({ replacedAt: new Date(Date.now() - 60 * 60 * 1000) }),
    );
    const qb = queryBuilder();
    refreshRepo.createQueryBuilder.mockReturnValue(qb);

    await expect(service.refreshTokens(REFRESH)).rejects.toThrow('reused');
    expect(qb.execute).toHaveBeenCalled(); // revokeFamily 실행
  });

  /**
   * 응답을 못 받은 클라이언트의 재시도(또는 웹·네이티브 동시 갱신)를 탈취로 오인하면,
   * 직전에 정상 발급된 새 토큰까지 family 폐기에 휩쓸려 멀쩡한 세션이 날아간다.
   */
  it('treats an immediate retry as a race, not a theft', async () => {
    const { service, jwtService, refreshRepo } = createHarness();
    jwtService.verify.mockReturnValue({ sub: 'u1' });
    refreshRepo.findOne.mockResolvedValue(activeRow({ replacedAt: new Date() }));
    const qb = queryBuilder();
    refreshRepo.createQueryBuilder.mockReturnValue(qb);

    await expect(service.refreshTokens(REFRESH)).rejects.toThrow('already rotated');
    expect(qb.execute).not.toHaveBeenCalled(); // family 는 살아 있어야 한다
  });

  /** 검사와 발급 사이에 다른 요청이 회전을 마치면(affected=0) 두 벌째를 발급하면 안 된다. */
  it('does not issue a second token when it loses the rotation race', async () => {
    const { service, jwtService, refreshRepo } = createHarness();
    jwtService.verify.mockReturnValue({ sub: 'u1' });
    refreshRepo.findOne.mockResolvedValue(activeRow());
    refreshRepo.createQueryBuilder.mockReturnValue(queryBuilder({ affected: 0 }));

    await expect(service.refreshTokens(REFRESH)).rejects.toThrow('already rotated');
    expect(refreshRepo.save).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    const { service, jwtService, refreshRepo } = createHarness();
    jwtService.verify.mockReturnValue({ sub: 'u1' });
    refreshRepo.findOne.mockResolvedValue(activeRow({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(service.refreshTokens(REFRESH)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rotates a valid token by claiming the row conditionally', async () => {
    const { service, jwtService, refreshRepo } = createHarness();
    jwtService.verify.mockReturnValue({ sub: 'u1' });
    refreshRepo.findOne.mockResolvedValue(activeRow());
    const qb = queryBuilder({ affected: 1 });
    refreshRepo.createQueryBuilder.mockReturnValue(qb);

    const tokens = await service.refreshTokens(REFRESH);

    expect(tokens.accessToken).toContain('u1');
    expect(qb.execute).toHaveBeenCalled(); // replacedAt 선점
  });
});

describe('AuthService — logout & kakao status', () => {
  it('logout is a no-op without a token', async () => {
    const { service, refreshRepo } = createHarness();
    await service.logout('');
    expect(refreshRepo.findOne).not.toHaveBeenCalled();
  });

  it('logout marks a live token revoked', async () => {
    const { service, refreshRepo } = createHarness();
    const row: any = { revokedAt: null };
    refreshRepo.findOne.mockResolvedValue(row);
    await service.logout('tok');
    expect(row.revokedAt).toBeInstanceOf(Date);
    expect(refreshRepo.save).toHaveBeenCalledWith(row);
  });

  it('reports kakao as not ready when keys are missing', () => {
    const { service } = createHarness();
    const status = service.getKakaoStatus();
    expect(status.ready).toBe(false);
    expect(status.missingKeys).toEqual(
      expect.arrayContaining(['KAKAO_REST_API_KEY', 'KAKAO_CALLBACK_URL']),
    );
  });

  it('throws when starting kakao auth while unconfigured', () => {
    const { service } = createHarness();
    expect(() => service.startKakaoAuth()).toThrow(BadRequestException);
  });

  /**
   * 예전엔 세션(refresh 토큰 포함)을 base64 로 프래그먼트에 실어 보내, 30일짜리 자격증명이
   * 브라우저 히스토리에 남았다. 이제 URL 에는 1회용 교환 코드만 있어야 한다.
   */
  it('puts only an exchange code in the success redirect', () => {
    const { service } = createHarness();
    const url = new URL(service.getWebKakaoSuccessUrl('exchange-code-123'));

    expect(url.hash).toBe('#code=exchange-code-123');
    expect(url.href).not.toContain('session=');
  });

  // state 가 authorize URL 에만 있고 콜백에서 대조되지 않으면 로그인 CSRF 가 열린다.
  it('binds a fresh state to every authorize URL', () => {
    const { service } = createHarness({
      KAKAO_REST_API_KEY: 'key',
      KAKAO_CALLBACK_URL: 'http://localhost:4000/api/v1/auth/kakao/callback',
    });

    const first = service.startKakaoAuth();
    const second = service.startKakaoAuth();

    expect(first.state).not.toBe(second.state);
    expect(new URL(first.authorizeUrl).searchParams.get('state')).toBe(first.state);
  });
});

describe('AuthService — password reset & verify', () => {
  it('does not leak whether an email exists on reset request', async () => {
    const { service, usersService, emailService } = createHarness();
    usersService.findByEmail.mockResolvedValue(null);
    const res = await service.requestPasswordReset('ghost@b.com');
    expect(res.ok).toBe(true);
    expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
  });

  // 링크 경로가 웹 라우트와 어긋나면 메일은 나가는데 클릭하면 404 라 재설정이 통째로 죽는다.
  it('sends a reset link pointing at the real web route', async () => {
    const { service, usersService, emailService } = createHarness();
    usersService.findByEmail.mockResolvedValue(user({ email: 'a@b.com', passwordHash: 'hash' }));

    await service.requestPasswordReset('a@b.com');

    const [to, link] = emailService.sendPasswordReset.mock.calls[0];
    expect(to).toBe('a@b.com');
    expect(link).toMatch(/^http:\/\/localhost:3000\/reset-password\?token=/);
  });

  it('rejects a weak new password on reset', async () => {
    const { service } = createHarness();
    await expect(service.resetPassword('tok', 'short')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('consumes the token, sets the password, and revokes sessions on reset', async () => {
    const { service, emailTokenRepo, usersService, refreshRepo } = createHarness();
    emailTokenRepo.findOne.mockResolvedValue({
      id: 'et-1',
      userId: 'u1',
      purpose: 'reset_password',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const qb = queryBuilder();
    refreshRepo.createQueryBuilder.mockReturnValue(qb);

    const res = await service.resetPassword('tok', 'abc12345');

    expect(usersService.setPassword).toHaveBeenCalledWith('u1', expect.any(String));
    expect(qb.execute).toHaveBeenCalled(); // revokeAll
    expect(res.ok).toBe(true);
  });

  it('rejects an already-consumed verification token', async () => {
    const { service, emailTokenRepo } = createHarness();
    emailTokenRepo.findOne.mockResolvedValue({
      id: 'et-1',
      userId: 'u1',
      purpose: 'verify_email',
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.verifyEmail('tok')).rejects.toBeInstanceOf(BadRequestException);
  });
});
