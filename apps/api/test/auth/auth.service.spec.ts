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

function createHarness() {
  const usersService = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    createEmailUser: jest.fn(),
    setPendingPassword: jest.fn(),
    markEmailVerified: jest.fn(),
    setPassword: jest.fn(),
    findOrCreateDemoUser: jest.fn(),
    findOrCreateByKakao: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(async (payload: any, opts?: any) => `jwt(${payload.sub})${opts ? '-r' : ''}`),
    verify: jest.fn(),
  };
  const emailService = { sendVerification: jest.fn(), sendPasswordReset: jest.fn() };
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
    config(),
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

  it('conflicts when the email already has a password', async () => {
    const { service, usersService } = createHarness();
    usersService.findByEmail.mockResolvedValue(user({ passwordHash: 'x' }));
    await expect(
      service.signupWithEmail({ email: 'a@b.com', password: 'abc12345', nickname: '앨리스' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
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

  it('stores only a pending password for an existing kakao user', async () => {
    const { service, usersService } = createHarness();
    usersService.findByEmail.mockResolvedValue(user({ email: 'a@b.com' })); // passwordHash 없음 = 카카오 가입자
    usersService.setPendingPassword.mockResolvedValue(user({ email: 'a@b.com' }));

    await service.signupWithEmail({ email: 'a@b.com', password: 'abc12345', nickname: '앨리스' } as any);
    expect(usersService.setPendingPassword).toHaveBeenCalledTimes(1);
    expect(usersService.createEmailUser).not.toHaveBeenCalled();
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

  it('detects reuse of an already-rotated token and revokes the family', async () => {
    const { service, jwtService, refreshRepo } = createHarness();
    jwtService.verify.mockReturnValue({ sub: 'u1' });
    refreshRepo.findOne.mockResolvedValue(activeRow({ replacedAt: new Date() }));
    const qb = queryBuilder();
    refreshRepo.createQueryBuilder.mockReturnValue(qb);

    await expect(service.refreshTokens(REFRESH)).rejects.toThrow('reused');
    expect(qb.execute).toHaveBeenCalled(); // revokeFamily 실행
  });

  it('rejects an expired token', async () => {
    const { service, jwtService, refreshRepo } = createHarness();
    jwtService.verify.mockReturnValue({ sub: 'u1' });
    refreshRepo.findOne.mockResolvedValue(activeRow({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(service.refreshTokens(REFRESH)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rotates a valid token and marks the old one replaced', async () => {
    const { service, jwtService, refreshRepo } = createHarness();
    jwtService.verify.mockReturnValue({ sub: 'u1' });
    const row = activeRow();
    refreshRepo.findOne.mockResolvedValue(row);

    const tokens = await service.refreshTokens(REFRESH);

    expect(tokens.accessToken).toContain('u1');
    expect(row.replacedAt).toBeInstanceOf(Date);
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

  it('throws when building the authorize URL while unconfigured', () => {
    const { service } = createHarness();
    expect(() => service.getKakaoAuthUrl()).toThrow(BadRequestException);
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
