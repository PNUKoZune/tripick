/// <reference types="jest" />

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { AuthService } from '../../src/auth/auth.service';
import { UserEntity } from '../../src/users/user.entity';

// 카카오 토큰·프로필 왕복만 대신한다. 이 파일의 다른 테스트는 axios 를 타지 않는다.
jest.mock('axios', () => {
  const stub = {
    post: jest.fn(async () => ({ data: { access_token: 'kakao-access' } })),
    get: jest.fn(async () => ({
      data: { id: 77, kakao_account: { email: 'a@b.com', profile: { nickname: '카카오' } } },
    })),
    isAxiosError: () => false,
  };
  return { __esModule: true, default: stub, ...stub };
});

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

/** `.update().set().where().execute()` 체인을 흉내내는 QueryBuilder 스텁. where 파라미터는 기록해 둔다. */
function queryBuilder(execResult: { affected?: number } = { affected: 1 }) {
  const qb: any = { wheres: [] as any[] };
  qb.update = () => qb;
  qb.set = () => qb;
  qb.where = (_sql: string, params?: any) => {
    qb.wheres.push(params ?? {});
    return qb;
  };
  qb.execute = jest.fn().mockResolvedValue(execResult);
  return qb;
}

/** 아직 살아 있는 인증 토큰 행. 대기 비밀번호·닉네임은 계정이 아니라 여기 실린다. */
function liveVerifyToken(pendingPasswordHash: string | null, over: Record<string, any> = {}) {
  return {
    id: 'et-old',
    userId: 'u1',
    purpose: 'verify_email',
    tokenHash: 'old-hash',
    pendingPasswordHash,
    pendingNickname: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...over,
  } as any;
}

function user(over: Partial<UserEntity> = {}): UserEntity {
  return { id: 'u1', nickname: '앨리스', ...over } as UserEntity;
}

function createHarness(configOverrides: Record<string, string> = {}) {
  const usersService = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    createEmailUser: jest.fn(),
    markEmailVerified: jest.fn(),
    setPassword: jest.fn(),
    findOrCreateByKakao: jest.fn(),
    existsForKakao: jest.fn().mockResolvedValue(true),
  };
  const jwtService = {
    signAsync: jest.fn(
      async (payload: any, opts?: any) => `jwt(${payload.sub})${opts ? '-r' : ''}`,
    ),
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
  const emailTokenQbs: any[] = [];
  const emailTokenRepo = {
    create: jest.fn((v: any) => v),
    save: jest.fn(async (v: any) => ({ id: v.id ?? 'et-1', ...v })),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => {
      const qb = queryBuilder();
      emailTokenQbs.push(qb);
      return qb;
    }),
  };
  /** 지금까지 만료 처리된 (userId, purpose) 목록. */
  const expiredTokenTargets = () => emailTokenQbs.flatMap((qb) => qb.wheres);
  const service = new AuthService(
    usersService as any,
    jwtService as any,
    config(configOverrides),
    emailService as any,
    refreshRepo as any,
    emailTokenRepo as any,
  );
  return {
    service,
    usersService,
    jwtService,
    emailService,
    refreshRepo,
    emailTokenRepo,
    expiredTokenTargets,
  };
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
      service.signupWithEmail({
        email: 'a@b.com',
        password: 'onlyletters',
        nickname: '앨리스',
      } as any),
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

    usersService.findByEmail.mockResolvedValue(
      user({ email: 'a@b.com', passwordHash: 'x', emailVerifiedAt: new Date() }),
    );
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
   * 같은 이메일로 동시에 가입하면 한쪽이 유니크 제약에 걸린다. 그대로 흘리면 500 이라,
   * 진 쪽은 "이미 있는 계정" 경로로 넘어가 신규 가입과 같은 응답을 내야 한다.
   */
  it('does not blow up when it loses a concurrent signup race', async () => {
    const { service, usersService, emailService } = createHarness();
    usersService.findByEmail
      .mockResolvedValueOnce(null) // 최초 조회: 없음
      .mockResolvedValueOnce(user({ email: 'a@b.com' })); // 경쟁자가 만든 계정 재조회
    usersService.createEmailUser.mockResolvedValue(null); // 유니크 충돌로 생성 실패

    const res = await service.signupWithEmail({
      email: 'a@b.com',
      password: 'abc12345',
      nickname: '앨리스',
    } as any);

    // 경쟁자가 만든 계정은 아직 미인증이라 "이미 가입됨" 안내가 아니라 인증 메일로 간다.
    expect(res).toMatchObject({ ok: true, email: 'a@b.com' });
    expect(emailService.sendVerification).toHaveBeenCalledTimes(1);
    expect(emailService.sendAccountExistsNotice).not.toHaveBeenCalled();
  });

  /**
   * 메일을 놓치고 다시 가입을 누르는 흐름. 인증 전이라 주인이 확정되지 않은 신청이므로
   * 안내가 아니라 인증 메일을 다시 보낸다 — 안내로 보내면 재설정도 인증 전이라 헛돈다.
   */
  it('re-sends verification when the pending signup was never verified', async () => {
    const { service, usersService, emailService, emailTokenRepo } = createHarness();
    usersService.findByEmail.mockResolvedValue(user({ email: 'a@b.com' }));
    // 먼저 들어온 신청이 남긴, 아직 살아 있는 토큰 (다른 비밀번호를 들고 있다)
    emailTokenRepo.findOne.mockResolvedValue(liveVerifyToken('first-signup-hash'));

    const res = await service.signupWithEmail({
      email: 'a@b.com',
      password: 'different1',
      nickname: '앨리스',
    } as any);

    expect(res).toMatchObject({ ok: true, email: 'a@b.com' });
    expect(emailService.sendVerification).toHaveBeenCalledTimes(1);
    expect(emailService.sendAccountExistsNotice).not.toHaveBeenCalled();
    expect(usersService.setPassword).not.toHaveBeenCalled();
    expect(usersService.createEmailUser).not.toHaveBeenCalled();
  });

  /**
   * 계정 선점 차단: 공격자가 피해자 이메일로 먼저 가입해 두면, 예전엔 **첫 신청의**
   * 비밀번호가 계정에 남아 피해자가 자기 가입 링크를 누르는 순간 그게 활성화됐다.
   * 이제 링크마다 자기 신청의 비밀번호를 들고 가므로 누른 링크의 것만 켜진다.
   */
  it('binds this request password to the token it sends, not the first signup', async () => {
    const { service, usersService, emailTokenRepo } = createHarness();
    usersService.findByEmail.mockResolvedValue(user({ email: 'a@b.com' }));
    emailTokenRepo.findOne.mockResolvedValue(
      liveVerifyToken('attacker-hash', { pendingNickname: '공격자' }),
    );

    await service.signupWithEmail({
      email: 'a@b.com',
      password: 'victim1234',
      nickname: '앨리스',
    } as any);

    const saved = emailTokenRepo.save.mock.calls.at(-1)![0] as any;
    expect(saved.purpose).toBe('verify_email');
    expect(saved.pendingPasswordHash).not.toBe('attacker-hash');
    expect(await bcrypt.compare('victim1234', saved.pendingPasswordHash)).toBe(true);
    // 닉네임도 같은 신청의 것이어야 한다 — 계정 이름은 첫 신청이 정하지만 주인은 링크를 누른 쪽이다.
    expect(saved.pendingNickname).toBe('앨리스');
  });

  /** 인증을 마친 이메일 계정은 주인이 확정된 상태 — 안내만 가고 인증 메일은 안 간다. */
  it('sends the account-exists notice for a verified email account', async () => {
    const { service, usersService, emailService } = createHarness();
    usersService.findByEmail.mockResolvedValue(
      user({ email: 'a@b.com', passwordHash: 'x', emailVerifiedAt: new Date() }),
    );

    await service.signupWithEmail({
      email: 'a@b.com',
      password: 'abc12345',
      nickname: '앨리스',
    } as any);

    expect(emailService.sendVerification).not.toHaveBeenCalled();
    expect(emailService.sendAccountExistsNotice).toHaveBeenCalledWith(
      'a@b.com',
      expect.objectContaining({ hasPassword: true }),
    );
  });

  /**
   * 계정 탈취 경로: 공격자가 피해자 이메일로 가입 → 피해자에게 "가입 인증" 메일 도착 →
   * 피해자가 누르는 순간 공격자 비밀번호가 활성화. 기존 계정은 손대지 않아야 한다.
   */
  it('never plants a password on an existing account', async () => {
    const { service, usersService, emailService } = createHarness();
    // 카카오 가입자(비밀번호 없음). 카카오 가입은 이메일이 인증된 것으로 간주된다.
    usersService.findByEmail.mockResolvedValue(
      user({ email: 'a@b.com', kakaoId: 'k1', emailVerifiedAt: new Date() }),
    );

    await service.signupWithEmail({
      email: 'a@b.com',
      password: 'attacker1',
      nickname: '공격자',
    } as any);

    expect(usersService.createEmailUser).not.toHaveBeenCalled();
    expect(emailService.sendVerification).not.toHaveBeenCalled();
    expect(emailService.sendAccountExistsNotice).toHaveBeenCalledWith(
      'a@b.com',
      expect.objectContaining({ hasPassword: false }),
    );
  });

  /**
   * 계정 생성이 메일 발송보다 먼저 커밋된다. 발송 실패를 그대로 올리면 "계정은 만들어졌는데
   * 가입은 500" 이 되어, 사용자가 재시도하면 이번엔 기존 계정 안내 메일을 받는다.
   */
  it('still answers ok when the verification mail fails to send', async () => {
    const { service, usersService, emailService } = createHarness();
    usersService.findByEmail.mockResolvedValue(null);
    usersService.createEmailUser.mockResolvedValue(user({ email: 'a@b.com' }));
    emailService.sendVerification.mockRejectedValue(new Error('Resend API 403'));

    const res = await service.signupWithEmail({
      email: 'a@b.com',
      password: 'abc12345',
      nickname: '앨리스',
    } as any);

    expect(res).toMatchObject({ ok: true, email: 'a@b.com' });
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
    const { service, usersService, emailTokenRepo } = createHarness();
    const pendingHash = await bcrypt.hash('abc12345', 10);
    usersService.findByEmail.mockResolvedValue(user());
    emailTokenRepo.findOne.mockResolvedValue(liveVerifyToken(pendingHash));
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
    usersService.findByEmail.mockResolvedValue(
      user({ id: 'u9', passwordHash: hash, email: 'a@b.com' }),
    );

    const res = await service.loginWithEmail({ email: 'a@b.com', password: 'correct1' } as any);

    expect(res.tokens.accessToken).toContain('u9');
    expect(res.tokens.refreshToken).toBeTruthy();
    expect(res.user).toMatchObject({ id: 'u9', hasPassword: true });
    // 최초 발급은 familyId 확정을 위해 2번 저장한다.
    expect(refreshRepo.save).toHaveBeenCalledTimes(2);
  });
});

describe('AuthService — login timing', () => {
  /**
   * 없는 계정에서 bcrypt(cost 12)를 건너뛰면 응답이 눈에 띄게 빨라져, 시간차만으로
   * 가입 여부를 훑을 수 있다. 두 경로 모두 해시 비교를 한 번씩 치러야 한다.
   */
  it('still hashes when the account does not exist', async () => {
    const { service, usersService } = createHarness();
    const realHash = await bcrypt.hash('somethingelse', 12);

    async function timeFailedLogin(): Promise<number> {
      const started = process.hrtime.bigint();
      await expect(
        service.loginWithEmail({ email: 'x@b.com', password: 'guess1234' } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      return Number(process.hrtime.bigint() - started) / 1e6;
    }

    usersService.findByEmail.mockResolvedValue(user({ passwordHash: realHash }));
    const wrongPasswordMs = await timeFailedLogin();

    usersService.findByEmail.mockResolvedValue(null);
    const missingAccountMs = await timeFailedLogin();

    // bcrypt(cost 12)는 이 환경에서 100ms 안팎이다. 더미 비교를 안 하면 1ms 도 안 걸린다.
    expect(wrongPasswordMs).toBeGreaterThan(20);
    expect(missingAccountMs).toBeGreaterThan(20);
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

  it('builds an Android package-scoped intent callback with a web fallback', () => {
    const { service } = createHarness({ WEB_APP_URL: 'https://tripick.place' });
    const intent = service.getKakaoSuccessUrl('exchange-code-123', 'android');

    expect(intent).toContain('intent://auth/kakao/callback?code=exchange-code-123');
    expect(intent).toContain('scheme=tripick');
    expect(intent).toContain('package=com.tripick.place');
    expect(intent).toContain(
      `S.browser_fallback_url=${encodeURIComponent(
        'https://tripick.place/auth/kakao/callback#code=exchange-code-123',
      )}`,
    );
  });

  // iOS 에는 `intent://` 가 없다. 셸의 인증 세션이 가로챌 커스텀 스킴을 그대로 돌려줘야 한다.
  it('builds a custom-scheme callback for iOS', () => {
    const { service } = createHarness({ WEB_APP_URL: 'https://tripick.place' });

    expect(service.getKakaoSuccessUrl('exchange-code-123', 'ios')).toBe(
      'tripick://auth/kakao/callback?code=exchange-code-123',
    );
    // 공백이 `+` 로 나가는 form 인코딩이다 — 앱 셸의 URLSearchParams 가 같은 규칙으로 되돌린다.
    expect(service.getKakaoErrorUrl('로그인 실패', 'ios')).toBe(
      `tripick://auth/kakao/callback?${new URLSearchParams({ error: '로그인 실패' }).toString()}`,
    );
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

  // scope 를 안 실으면 콘솔 기본 동의항목만 내려온다 — 닉네임이 빠지면 사용자 이름이 전부
  // 폴백('여행자')이 되고, 이메일이 빠지면 이메일 계정과 자동 merge 를 못 탄다.
  it('requests the nickname and email consent scopes', () => {
    const { service } = createHarness({
      KAKAO_REST_API_KEY: 'key',
      KAKAO_CALLBACK_URL: 'http://localhost:4000/api/v1/auth/kakao/callback',
    });

    const scope = new URL(service.startKakaoAuth().authorizeUrl).searchParams.get('scope');

    expect(scope?.split(',')).toEqual(['profile_nickname', 'account_email']);
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

  /**
   * 재발송은 자기 비밀번호가 없다. 살아 있는 토큰의 것을 이어받지 않으면 재발송 링크가
   * 인증만 하고 비밀번호 없는 계정을 만들어, 방금 가입한 사용자가 로그인을 못 한다.
   */
  it('carries the pending password forward on resend', async () => {
    const { service, usersService, emailTokenRepo } = createHarness();
    usersService.findByEmail.mockResolvedValue(user({ email: 'a@b.com' }));
    emailTokenRepo.findOne.mockResolvedValue(
      liveVerifyToken('signup-hash', { pendingNickname: '보통사용자' }),
    );

    await service.resendVerification('a@b.com');

    const saved = emailTokenRepo.save.mock.calls.at(-1)![0] as any;
    expect(saved.pendingPasswordHash).toBe('signup-hash');
    expect(saved.pendingNickname).toBe('보통사용자');
  });

  /** 만료된 토큰의 비밀번호는 이어받지 않는다 — 죽은 신청을 재발송으로 되살리는 셈이 된다. */
  it('does not carry a password forward from an expired token', async () => {
    const { service, usersService, emailTokenRepo } = createHarness();
    usersService.findByEmail.mockResolvedValue(user({ email: 'a@b.com' }));
    emailTokenRepo.findOne.mockResolvedValue(
      liveVerifyToken('stale-hash', { expiresAt: new Date(Date.now() - 1000) }),
    );

    await service.resendVerification('a@b.com');

    const saved = emailTokenRepo.save.mock.calls.at(-1)![0] as any;
    expect(saved.pendingPasswordHash).toBeNull();
  });

  /** 켜지는 비밀번호·닉네임은 계정에 남은 값이 아니라 **소비한 토큰**이 들고 온 것이어야 한다. */
  it('promotes the password and nickname carried by the consumed token', async () => {
    const { service, emailTokenRepo, usersService } = createHarness();
    emailTokenRepo.findOne.mockResolvedValue(
      liveVerifyToken('this-token-hash', {
        id: 'et-1',
        consumedAt: null,
        pendingNickname: '링크를 누른 사람',
      }),
    );
    usersService.findById.mockResolvedValue(user());

    await service.verifyEmail('tok');

    expect(usersService.markEmailVerified).toHaveBeenCalledWith('u1', {
      passwordHash: 'this-token-hash',
      nickname: '링크를 누른 사람',
    });
  });

  it('rejects a weak new password on reset', async () => {
    const { service } = createHarness();
    await expect(service.resetPassword('tok', 'short')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('consumes the token, sets the password, and revokes sessions on reset', async () => {
    const { service, emailTokenRepo, usersService, refreshRepo, expiredTokenTargets } =
      createHarness();
    emailTokenRepo.findOne.mockResolvedValue({
      id: 'et-1',
      userId: 'u1',
      purpose: 'reset_password',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    usersService.findById.mockResolvedValue(user());
    const qb = queryBuilder();
    refreshRepo.createQueryBuilder.mockReturnValue(qb);

    const res = await service.resetPassword('tok', 'abc12345');

    expect(usersService.setPassword).toHaveBeenCalledWith('u1', expect.any(String));
    expect(qb.execute).toHaveBeenCalled(); // revokeAll
    expect(res.ok).toBe(true);
    // 살아 있던 가입 신청 토큰도 함께 무효화한다 — 자기 비밀번호를 들고 있는 링크를
    // 남겨 두면 방금 확정한 비밀번호 위로 나중에 다시 손댈 여지가 남는다.
    expect(expiredTokenTargets()).toContainEqual(
      expect.objectContaining({ userId: 'u1', purpose: 'verify_email' }),
    );
  });

  /**
   * 소비를 먼저 하면 계정이 없을 때 토큰만 태워지고, 사용자는 이미 죽은 링크를 들고
   * 재발송을 받아야 한다. 사전 조건을 다 본 뒤에 소비해야 한다.
   */
  it('does not burn the token when the account is gone', async () => {
    const { service, emailTokenRepo, usersService } = createHarness();
    emailTokenRepo.findOne.mockResolvedValue({
      id: 'et-1',
      userId: 'u1',
      purpose: 'verify_email',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    usersService.findById.mockResolvedValue(null);
    const qb = queryBuilder();
    emailTokenRepo.createQueryBuilder.mockReturnValue(qb);

    await expect(service.verifyEmail('tok')).rejects.toBeInstanceOf(NotFoundException);
    expect(qb.execute).not.toHaveBeenCalled(); // consumedAt 갱신이 없어야 한다
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

describe('AuthService — 로그인 상태 비밀번호 변경', () => {
  /** 현재 비밀번호 `pw-old-1` 을 가진 계정. 해시는 실제 bcrypt 라 비교 경로가 그대로 돈다. */
  async function passwordUser(plain = 'pw-old-1') {
    return user({ email: 'a@b.com', passwordHash: await bcrypt.hash(plain, 4) });
  }

  it('현재 비밀번호가 틀리면 403 — 401 은 클라이언트가 세션 만료로 읽어 로그아웃시킨다', async () => {
    const { service, usersService } = createHarness();
    usersService.findById.mockResolvedValue(await passwordUser());

    await expect(
      service.changePassword('u1', { currentPassword: 'wrong-one', newPassword: 'abc12345' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(usersService.setPassword).not.toHaveBeenCalled();
  });

  it('비밀번호가 없는 계정(카카오 단독)은 이 경로를 못 쓴다 — 재설정 플로우로 보낸다', async () => {
    const { service, usersService } = createHarness();
    usersService.findById.mockResolvedValue(user({ kakaoId: '77' }));

    await expect(
      service.changePassword('u1', { currentPassword: '', newPassword: 'abc12345' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(usersService.setPassword).not.toHaveBeenCalled();
  });

  it('새 비밀번호도 가입과 같은 규칙을 통과해야 한다', async () => {
    const { service, usersService } = createHarness();
    usersService.findById.mockResolvedValue(await passwordUser());

    await expect(
      service.changePassword('u1', { currentPassword: 'pw-old-1', newPassword: 'onlyletters' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('지금 쓰는 값 그대로면 거절한다 — 바꾸지 않고 다른 기기만 끊는 요청', async () => {
    const { service, usersService } = createHarness();
    usersService.findById.mockResolvedValue(await passwordUser('abc12345'));

    await expect(
      service.changePassword('u1', { currentPassword: 'abc12345', newPassword: 'abc12345' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(usersService.setPassword).not.toHaveBeenCalled();
  });

  /**
   * 다른 기기는 끊되 이 기기는 이어져야 한다. refresh 를 전부 폐기한 뒤 새로 발급하지
   * 않으면, 비밀번호를 바꾼 사람이 다음 갱신에서 자기만 로그아웃된다.
   */
  it('다른 기기 세션을 끊고 이 기기 몫의 새 토큰을 돌려준다', async () => {
    const { service, usersService, refreshRepo, expiredTokenTargets } = createHarness();
    usersService.findById.mockResolvedValue(await passwordUser());
    const qb = queryBuilder();
    refreshRepo.createQueryBuilder.mockReturnValue(qb);

    const res = await service.changePassword('u1', {
      currentPassword: 'pw-old-1',
      newPassword: 'abc12345',
    });

    expect(usersService.setPassword).toHaveBeenCalledWith('u1', expect.any(String));
    expect(qb.wheres).toContainEqual(expect.objectContaining({ userId: 'u1' })); // revokeAll
    expect(res.tokens.accessToken).toBeTruthy();
    expect(res.tokens.refreshToken).toBeTruthy();
    expect(res.user).toMatchObject({ id: 'u1', hasPassword: true });
    // 살아 있던 재설정·가입 링크는 무효화한다 — 옛 링크로 방금 정한 값을 덮을 수 있으면
    // 변경한 의미가 없다.
    expect(expiredTokenTargets()).toContainEqual(
      expect.objectContaining({ userId: 'u1', purpose: 'reset_password' }),
    );
    expect(expiredTokenTargets()).toContainEqual(
      expect.objectContaining({ userId: 'u1', purpose: 'verify_email' }),
    );
  });
});

describe('AuthService — kakao login', () => {
  /**
   * 카카오 로그인은 같은 이메일의 미인증 가입을 merge 하면서 계정을 인증 상태로 만든다.
   * 그때 대기 중이던 가입 신청 토큰을 남겨 두면, 그 토큰을 쥔 쪽이 나중에 링크를 태워
   * 이 계정에 비밀번호를 심을 수 있다 — 카카오 단독 계정은 passwordHash 가 비어 있어
   * 승격 가드에도 걸리지 않는다. 이메일 비밀번호는 재설정 플로우로만 붙어야 한다.
   */
  it('expires pending verification tokens so nobody can plant a password later', async () => {
    const { service, usersService, expiredTokenTargets } = createHarness({
      KAKAO_REST_API_KEY: 'key',
      KAKAO_CALLBACK_URL: 'http://localhost:4000/api/v1/auth/kakao/callback',
    });
    usersService.findOrCreateByKakao.mockResolvedValue(
      user({ id: 'u1', email: 'a@b.com', kakaoId: '77', emailVerifiedAt: new Date() }),
    );

    await service.resolveKakaoLogin('code');

    expect(expiredTokenTargets()).toContainEqual(
      expect.objectContaining({ userId: 'u1', purpose: 'verify_email' }),
    );
  });

  /**
   * 약관 동의 전에 계정이 생기면, 동의 화면을 닫고 떠난 사람의 계정이 그대로 남는다
   * (이용약관 제5조는 동의를 가입 성립 요건으로 둔다). 그래서 처음 오는 카카오 프로필은
   * 계정을 만들지 않고 프로필만 돌려줘야 한다.
   */
  it('does not create an account for a first-time kakao profile — consent comes first', async () => {
    const { service, usersService } = createHarness({
      KAKAO_REST_API_KEY: 'key',
      KAKAO_CALLBACK_URL: 'http://localhost:4000/api/v1/auth/kakao/callback',
    });
    usersService.existsForKakao.mockResolvedValue(false);

    const resolved = await service.resolveKakaoLogin('code');

    expect(resolved.kind).toBe('consent');
    expect(usersService.findOrCreateByKakao).not.toHaveBeenCalled();
  });

  it('creates the account once consent is done', async () => {
    const { service, usersService } = createHarness({
      KAKAO_REST_API_KEY: 'key',
      KAKAO_CALLBACK_URL: 'http://localhost:4000/api/v1/auth/kakao/callback',
    });
    usersService.findOrCreateByKakao.mockResolvedValue(user({ id: 'u2', kakaoId: '77' }));

    const session = await service.completeKakaoSignup({ id: '77', nickname: '카카오' });

    expect(usersService.findOrCreateByKakao).toHaveBeenCalledWith(
      expect.objectContaining({ id: '77' }),
    );
    expect(session.user.id).toBe('u2');
  });
});
