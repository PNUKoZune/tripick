/// <reference types="jest" />

import { HttpException } from '@nestjs/common';
import { AuthController } from '../../src/auth/auth.controller';

function makeController(
  consume = jest.fn().mockResolvedValue({ allowed: true, retryAfter: 0 }),
) {
  const authService = {
    signupWithEmail: jest.fn().mockResolvedValue({ ok: true }),
    resendVerification: jest.fn().mockResolvedValue({ ok: true }),
    requestPasswordReset: jest.fn().mockResolvedValue({ ok: true }),
  };
  const controller = new AuthController(
    authService as any,
    {} as any,
    { consume } as any,
    { get: () => undefined } as any,
  );
  const res = { setHeader: jest.fn() } as any;
  return { controller, authService, consume, res };
}

const signupBody = { email: 'a@b.com', password: 'abcd1234', nickname: '여행자' } as any;

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
