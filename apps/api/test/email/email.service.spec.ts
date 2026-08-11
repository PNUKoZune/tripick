/// <reference types="jest" />

import * as nodemailer from 'nodemailer';
import { EmailService } from '../../src/email/email.service';

const sendMail = jest.fn();
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail })) }));
const createTransport = nodemailer.createTransport as jest.Mock;

function config(overrides: Record<string, string> = {}) {
  return {
    get: <T>(key: string, def?: T) => (key in overrides ? (overrides[key] as unknown as T) : def),
  } as any;
}

function smtpService(extra: Record<string, string> = {}) {
  const svc = new EmailService(config({ EMAIL_TRANSPORT: 'smtp', SMTP_HOST: 'localhost', ...extra }));
  svc.onModuleInit();
  return svc;
}

function resendService(extra: Record<string, string> = {}) {
  const svc = new EmailService(
    config({ EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test_key', ...extra }),
  );
  svc.onModuleInit();
  return svc;
}

const fetchMock = jest.fn();
beforeAll(() => {
  (globalThis as any).fetch = fetchMock;
});

describe('EmailService — transport modes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('defaults to console mode and never touches SMTP', async () => {
    const svc = new EmailService(config());
    svc.onModuleInit();
    expect(createTransport).not.toHaveBeenCalled();

    await svc.send({ to: 'a@b.com', subject: 's', text: 't', html: '<p>t</p>' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('falls back to console when EMAIL_TRANSPORT=smtp but SMTP_HOST is missing', async () => {
    const svc = new EmailService(config({ EMAIL_TRANSPORT: 'smtp' }));
    svc.onModuleInit();
    expect(createTransport).not.toHaveBeenCalled();

    await svc.send({ to: 'a@b.com', subject: 's', text: 't', html: '<p>t</p>' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('refuses to boot in production when no transport can deliver', () => {
    // console 폴백은 프로덕션에서 조용한 사고다 — 응답은 200, 메일은 0통, 알림도 없음.
    const cases = [
      { EMAIL_TRANSPORT: 'console' },
      { EMAIL_TRANSPORT: 'resend' }, // RESEND_API_KEY 없음
      { EMAIL_TRANSPORT: 'smtp' }, // SMTP_HOST 없음
      {}, // 미설정 → console 기본값
    ];
    for (const extra of cases) {
      const svc = new EmailService(config({ NODE_ENV: 'production', ...extra }));
      expect(() => svc.onModuleInit()).toThrow(/이메일 발송이 설정되지 않았습니다/);
    }
  });

  it('boots in production when a transport is actually configured', () => {
    const svc = new EmailService(
      config({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_live' }),
    );
    expect(() => svc.onModuleInit()).not.toThrow();
  });

  it('sends through SMTP when configured', async () => {
    sendMail.mockResolvedValue({});
    const svc = smtpService({ EMAIL_FROM: 'From <from@tripick.place>' });
    expect(createTransport).toHaveBeenCalledTimes(1);

    await svc.send({ to: 'a@b.com', subject: '제목', text: '본문', html: '<p>본문</p>' });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'From <from@tripick.place>',
        to: 'a@b.com',
        subject: '제목',
        text: '본문',
        html: '<p>본문</p>',
      }),
    );
  });

  it('rethrows when SMTP delivery fails', async () => {
    sendMail.mockRejectedValue(new Error('smtp down'));
    const svc = smtpService();
    await expect(
      svc.send({ to: 'a@b.com', subject: 's', text: 't', html: '<p>t</p>' }),
    ).rejects.toThrow('smtp down');
  });

  it('bounds SMTP timeouts so a blocked port cannot hold the request open', () => {
    smtpService({ EMAIL_SEND_TIMEOUT_MS: '4000' });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 4000,
        greetingTimeout: 4000,
        socketTimeout: 4000,
      }),
    );
  });
});

describe('EmailService — Resend HTTP transport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('falls back to console when EMAIL_TRANSPORT=resend but the API key is missing', async () => {
    const svc = new EmailService(config({ EMAIL_TRANSPORT: 'resend' }));
    svc.onModuleInit();

    await svc.send({ to: 'a@b.com', subject: 's', text: 't', html: '<p>t</p>' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('posts to the Resend API with the bearer key and never opens an SMTP socket', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const svc = resendService({ EMAIL_FROM: 'From <from@tripick.place>' });

    await svc.send({ to: 'a@b.com', subject: '제목', text: '본문', html: '<p>본문</p>' });

    expect(createTransport).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer re_test_key');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'From <from@tripick.place>',
      to: ['a@b.com'],
      subject: '제목',
      text: '본문',
      html: '<p>본문</p>',
    });
  });

  it('surfaces the response body on a non-2xx so the cause is in the log', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"message":"The tripick.place domain is not verified"}',
    });
    const svc = resendService();

    await expect(
      svc.send({ to: 'a@b.com', subject: 's', text: 't', html: '<p>t</p>' }),
    ).rejects.toThrow(/403.*not verified/);
  });

  it('rethrows transport-level failures (timeout/abort)', async () => {
    fetchMock.mockRejectedValue(new Error('The operation was aborted due to timeout'));
    const svc = resendService();

    await expect(
      svc.send({ to: 'a@b.com', subject: 's', text: 't', html: '<p>t</p>' }),
    ).rejects.toThrow('aborted due to timeout');
  });
});

describe('EmailService — templated mails', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds a verification mail carrying the link and escaping it in the display span', async () => {
    sendMail.mockResolvedValue({});
    const svc = smtpService();
    const link = 'https://tripick.place/auth/verify-email?token=abc&x=1';

    await svc.sendVerification('user@b.com', link);

    const mail = sendMail.mock.calls[0]?.[0];
    expect(mail.subject).toContain('이메일 인증');
    expect(mail.text).toContain(link);
    expect(mail.html).toContain('href="' + link + '"'); // href 는 원본 URL
    expect(mail.html).toContain('token=abc&amp;x=1'); // 표시용 span 은 이스케이프
  });

  it('builds a password-reset mail with the reset link', async () => {
    sendMail.mockResolvedValue({});
    const svc = smtpService();
    const link = 'https://tripick.place/auth/reset-password?token=xyz';

    await svc.sendPasswordReset('user@b.com', link);

    const mail = sendMail.mock.calls[0]?.[0];
    expect(mail.subject).toContain('비밀번호 재설정');
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(link);
  });
});
