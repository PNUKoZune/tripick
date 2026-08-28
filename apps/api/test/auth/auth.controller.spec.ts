/// <reference types="jest" />

import { HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../../src/auth/auth.controller';

function makeController(consume = jest.fn().mockResolvedValue({ allowed: true, retryAfter: 0 })) {
  const authService = {
    signupWithEmail: jest.fn().mockResolvedValue({ ok: true }),
    resendVerification: jest.fn().mockResolvedValue({ ok: true }),
    requestPasswordReset: jest.fn().mockResolvedValue({ ok: true }),
    startKakaoAuth: jest
      .fn()
      .mockReturnValue({
        authorizeUrl: 'https://kauth.kakao.com/oauth/authorize',
        state: 'state-1',
      }),
    resolveKakaoLogin: jest
      .fn()
      .mockResolvedValue({ kind: 'session', session: { tokens: {}, user: {} } }),
    completeKakaoSignup: jest.fn().mockResolvedValue({ tokens: {}, user: {} }),
    getWebKakaoSuccessUrl: jest.fn((code: string) => `https://tripick.place/callback#${code}`),
    getWebKakaoErrorUrl: jest.fn((message: string) => `https://tripick.place/error?m=${message}`),
    getAndroidKakaoSuccessUrl: jest.fn((code: string) => `intent://success?code=${code}`),
    getAndroidKakaoErrorUrl: jest.fn((message: string) => `intent://error?message=${message}`),
  };
  const kakaoExchange = {
    issue: jest.fn().mockResolvedValue('exchange-1'),
    consume: jest.fn(),
    issueSignupTicket: jest.fn().mockResolvedValue('signup-ticket-1'),
    consumeSignupTicket: jest.fn(),
  };
  const controller = new AuthController(
    authService as any,
    kakaoExchange as any,
    { consume } as any,
    { get: () => undefined } as any,
  );
  const res = {
    setHeader: jest.fn(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
  } as any;
  return { controller, authService, kakaoExchange, consume, res };
}

const signupBody = { email: 'a@b.com', password: 'abcd1234', nickname: '여행자' } as any;

/** 웹이 로그인 시작 때 만들어 보내는 bind 비밀(32자 이상 base64url). */
const BIND = 'bind-secret-that-is-long-enough-000000000000';

describe('AuthController — 주소별 메일 한도', () => {
  it('가입도 한도를 소모한다 — 재발송 라우트와 같은 verify 버킷', async () => {
    // 버킷이 갈리면 /auth/signup 으로 재발송 한도를 그대로 우회할 수 있다.
    const { controller, consume, res } = makeController();
    await controller.signup(signupBody, res);
    await controller.resendVerification({ email: 'a@b.com' } as any, res);

    expect(consume).toHaveBeenCalledTimes(2);
    expect(consume).toHaveBeenNthCalledWith(1, 'a@b.com', 'verify');
    expect(consume).toHaveBeenNthCalledWith(2, 'a@b.com', 'verify');
  });

  it('한도를 넘긴 가입은 429 로 끊고 계정·메일 로직까지 가지 않는다', async () => {
    const consume = jest.fn().mockResolvedValue({ allowed: false, retryAfter: 1800 });
    const { controller, authService, res } = makeController(consume);

    await expect(controller.signup(signupBody, res)).rejects.toBeInstanceOf(HttpException);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '1800');
    expect(authService.signupWithEmail).not.toHaveBeenCalled();
  });

  it('재설정 메일은 별도 버킷을 쓴다', async () => {
    const { controller, consume, res } = makeController();
    await controller.forgotPassword({ email: 'a@b.com' } as any, res);
    expect(consume).toHaveBeenCalledWith('a@b.com', 'reset');
  });
});

describe('AuthController — Android Kakao 복귀', () => {
  it('remembers that OAuth started from the Android shell', () => {
    const { controller, res } = makeController();

    controller.kakaoLogin('android', BIND, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'tripick_kakao_return',
      'android',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('redirects a completed Android login to the package-scoped intent', async () => {
    const { controller, authService, res } = makeController();
    const req = {
      headers: {
        cookie: `tripick_kakao_state=state-1; tripick_kakao_bind=${BIND}; tripick_kakao_return=android`,
      },
    } as any;

    await controller.kakaoCallback('kakao-code', 'state-1', undefined, req, res);

    expect(authService.getAndroidKakaoSuccessUrl).toHaveBeenCalledWith('exchange-1');
    expect(res.redirect).toHaveBeenCalledWith('intent://success?code=exchange-1');
  });
});

/**
 * 교환 코드를 시작한 브라우저에 묶는다. state 는 카카오 왕복만 지키므로, 코드만으로 교환이
 * 되면 공격자가 자기 로그인으로 얻은 코드를 피해자에게 던져 **피해자를 공격자 계정으로**
 * 로그인시킬 수 있다(웹은 링크, 앱은 tripick:// 딥링크).
 */
describe('AuthController — 카카오 교환 코드 브라우저 바인딩', () => {
  it('bind 를 코드에 실어 발급한다', async () => {
    const { controller, kakaoExchange, res } = makeController();
    const req = {
      headers: { cookie: `tripick_kakao_state=state-1; tripick_kakao_bind=${BIND}` },
    } as any;

    await controller.kakaoCallback('kakao-code', 'state-1', undefined, req, res);

    expect(kakaoExchange.issue).toHaveBeenCalledWith(expect.anything(), BIND);
  });

  it('bind 없이 시작하면 카카오로 보내지 않는다', () => {
    const { controller, authService, res } = makeController();

    controller.kakaoLogin(undefined, undefined, res);

    expect(authService.startKakaoAuth).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/error'));
  });

  it('짧아서 추측 가능한 bind 는 거부한다', () => {
    const { controller, authService, res } = makeController();

    controller.kakaoLogin(undefined, '1', res);

    expect(authService.startKakaoAuth).not.toHaveBeenCalled();
  });

  it('bind 쿠키가 없는 콜백은 코드를 발급하지 않는다', async () => {
    const { controller, kakaoExchange, res } = makeController();
    const req = { headers: { cookie: 'tripick_kakao_state=state-1' } } as any;

    await controller.kakaoCallback('kakao-code', 'state-1', undefined, req, res);

    expect(kakaoExchange.issue).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/error'));
  });

  it('교환은 코드와 bind 를 함께 넘긴다', async () => {
    const { controller, kakaoExchange } = makeController();

    await controller.kakaoExchangeCode({ code: 'exchange-1', bind: BIND } as any);

    expect(kakaoExchange.consume).toHaveBeenCalledWith('exchange-1', BIND);
  });
});

/**
 * 처음 오는 카카오 사용자는 약관 동의를 받기 전에는 계정이 생기면 안 된다
 * (이용약관 제5조 — 동의가 가입 성립 요건). 콜백은 세션이 아니라 대기표만 끊고,
 * 계정은 동의 화면이 되돌아오는 `kakao/signup` 에서 만들어진다.
 */
describe('AuthController — 카카오 신규 가입 약관 동의', () => {
  const cookieReq = {
    headers: { cookie: `tripick_kakao_state=state-1; tripick_kakao_bind=${BIND}` },
  } as any;

  it('신규 프로필이면 세션 코드가 아니라 가입 대기표를 발급한다', async () => {
    const { controller, authService, kakaoExchange, res } = makeController();
    authService.resolveKakaoLogin.mockResolvedValue({
      kind: 'consent',
      profile: { id: '77', nickname: '카카오' },
    });

    await controller.kakaoCallback('kakao-code', 'state-1', undefined, cookieReq, res);

    expect(kakaoExchange.issue).not.toHaveBeenCalled();
    expect(kakaoExchange.issueSignupTicket).toHaveBeenCalledWith(
      expect.objectContaining({ id: '77' }),
      BIND,
    );
  });

  it('교환에서 세션 코드가 아니면 동의 요구로 응답한다', async () => {
    const { controller, kakaoExchange } = makeController();
    kakaoExchange.consume.mockRejectedValue(new UnauthorizedException('없음'));
    kakaoExchange.consumeSignupTicket.mockResolvedValue({
      id: '77',
      nickname: '카카오',
      email: 'a@b.com',
    });

    const result = await controller.kakaoExchangeCode({ code: 'ticket-1', bind: BIND } as any);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'consent_required',
        consentCode: 'signup-ticket-1',
        nickname: '카카오',
        email: 'a@b.com',
      }),
    );
  });

  it('동의 완료 요청에서만 계정을 만든다', async () => {
    const { controller, authService, kakaoExchange } = makeController();
    kakaoExchange.consumeSignupTicket.mockResolvedValue({ id: '77', nickname: '카카오' });

    await controller.kakaoSignup({ code: 'signup-ticket-1', bind: BIND } as any, {
      headers: {},
    } as any);

    expect(kakaoExchange.consumeSignupTicket).toHaveBeenCalledWith('signup-ticket-1', BIND);
    expect(authService.completeKakaoSignup).toHaveBeenCalledWith(
      expect.objectContaining({ id: '77' }),
      expect.anything(),
    );
  });
});
