import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * 이메일 발송 추상.
 *
 * 동작 모드:
 * - `EMAIL_TRANSPORT=console` (기본): SMTP 안 띄우고 콘솔에 본문만 출력. 가장 빠른 dev 동선.
 * - `EMAIL_TRANSPORT=smtp`: `SMTP_HOST/PORT/USER/PASS` 사용. 로컬 Mailpit (1025) 또는 SaaS (Resend SMTP 등).
 *
 * 주의: 본문은 plain text + HTML 동시 발송. 인증 링크는 클릭만으로 동작하도록 URL 그대로.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter?: Transporter;
  private fromAddress = 'TriPick <noreply@tripick.place>';
  private mode: 'console' | 'smtp' = 'console';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const mode = (this.config.get<string>('EMAIL_TRANSPORT') ?? 'console').toLowerCase();
    const from = this.config.get<string>('EMAIL_FROM');
    if (from) this.fromAddress = from;

    if (mode === 'smtp') {
      const host = this.config.get<string>('SMTP_HOST');
      const port = Number(this.config.get<string>('SMTP_PORT') ?? '1025');
      const user = this.config.get<string>('SMTP_USER');
      const pass = this.config.get<string>('SMTP_PASS');
      const secure = this.config.get<string>('SMTP_SECURE') === 'true';
      if (!host) {
        this.logger.warn(
          'EMAIL_TRANSPORT=smtp but SMTP_HOST is missing — falling back to console mode',
        );
        return;
      }
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user && pass ? { user, pass } : undefined,
      });
      this.mode = 'smtp';
      this.logger.log(`Email transport: SMTP ${host}:${port}`);
    } else {
      this.logger.log('Email transport: console (no SMTP)');
    }
  }

  async send(params: { to: string; subject: string; text: string; html: string }): Promise<void> {
    if (this.mode === 'console' || !this.transporter) {
      this.logger.log(
        `\n[EMAIL >] to=${params.to}\nsubject: ${params.subject}\n---\n${params.text}\n---`,
      );
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
      });
    } catch (err) {
      this.logger.error(`Failed to send email to ${params.to}: ${(err as Error).message}`);
      throw err;
    }
  }

  /** 이메일 인증 메일 발송 */
  async sendVerification(to: string, link: string): Promise<void> {
    await this.send({
      to,
      subject: '[TriPick] 이메일 인증을 완료해주세요',
      text: `TriPick 에 가입해주셔서 감사합니다.\n\n아래 링크를 24시간 안에 클릭해 이메일 인증을 완료해주세요.\n\n${link}\n\n본인이 가입한 적 없다면 이 메일을 무시해주세요.`,
      html: buildEmailHtml({
        title: '이메일 인증을 완료해주세요',
        message: 'TriPick 에 가입해주셔서 감사합니다. 아래 버튼을 24시간 안에 눌러 이메일 인증을 완료해주세요.',
        ctaLabel: '이메일 인증하기',
        ctaUrl: link,
        footer: '본인이 가입한 적 없다면 이 메일을 무시해주세요.',
      }),
    });
  }

  /** 비밀번호 재설정 메일 발송 */
  async sendPasswordReset(to: string, link: string): Promise<void> {
    await this.send({
      to,
      subject: '[TriPick] 비밀번호 재설정 안내',
      text: `비밀번호 재설정 요청을 받았습니다.\n\n아래 링크를 1시간 안에 클릭해 새 비밀번호를 설정해주세요.\n\n${link}\n\n본인이 요청하지 않았다면 이 메일을 무시해주세요. 비밀번호는 변경되지 않습니다.`,
      html: buildEmailHtml({
        title: '비밀번호 재설정',
        message: '비밀번호 재설정 요청을 받았습니다. 아래 버튼을 1시간 안에 눌러 새 비밀번호를 설정해주세요.',
        ctaLabel: '비밀번호 재설정',
        ctaUrl: link,
        footer: '본인이 요청하지 않았다면 이 메일을 무시해주세요. 비밀번호는 변경되지 않습니다.',
      }),
    });
  }
}

function buildEmailHtml(params: {
  title: string;
  message: string;
  ctaLabel: string;
  ctaUrl: string;
  footer: string;
}): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#F7F8FA;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',Segoe UI,Roboto,sans-serif;color:#191F28;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;">
    <div style="font-weight:800;color:#3182F6;font-size:14px;">TriPick</div>
    <h1 style="font-size:22px;margin:8px 0 16px;">${escapeHtml(params.title)}</h1>
    <p style="font-size:14px;line-height:22px;color:#4E5968;">${escapeHtml(params.message)}</p>
    <p style="margin:24px 0;"><a href="${params.ctaUrl}" style="display:inline-block;background:#3182F6;color:#fff;text-decoration:none;padding:14px 24px;border-radius:12px;font-weight:700;">${escapeHtml(params.ctaLabel)}</a></p>
    <p style="font-size:12px;color:#8B95A1;line-height:18px;word-break:break-all;">버튼이 동작하지 않으면 아래 링크를 복사해 브라우저에 붙여넣어 주세요.<br/><span style="color:#6B7684;">${escapeHtml(params.ctaUrl)}</span></p>
    <hr style="border:none;border-top:1px solid #E5E8EB;margin:24px 0;"/>
    <p style="font-size:12px;color:#8B95A1;line-height:18px;">${escapeHtml(params.footer)}</p>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
