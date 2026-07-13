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
