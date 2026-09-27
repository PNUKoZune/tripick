import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { UserEntity } from '../users/user.entity';
import { DEMO_CONSOLE_EMAILS_ENV } from './demo-console.constants';

/**
 * 시연 콘솔 접근 제한.
 *
 * 콘솔은 로그인한 사용자의 데이터를 조작하고 알림을 쏘는 도구라, 인증만으로는 부족하다.
 * `DEMO_CONSOLE_EMAILS` 에 적힌 계정만 통과시키고, 프로덕션에서 그 목록이 비어 있으면
 * (= 누가 켜 놓고 잠그는 걸 잊었으면) 아무도 통과시키지 않는다 — 열려 있는 편보다 막힌 편이 낫다.
 */
@Injectable()
export class DemoConsoleGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: UserEntity }>();
    const email = request.user?.email?.trim().toLowerCase();
    const allowlist = demoConsoleEmails(this.config);

    if (allowlist.length === 0) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new ForbiddenException(
          `${DEMO_CONSOLE_EMAILS_ENV} 가 비어 있어 시연 콘솔을 사용할 수 없습니다.`,
        );
      }
      // 개발 환경은 로컬 데이터라 로그인만으로 연다.
      return true;
    }

    if (!email || !allowlist.includes(email)) {
      throw new ForbiddenException('시연 콘솔 사용 권한이 없는 계정입니다.');
    }
    return true;
  }
}

/** 허용 계정 목록(소문자·중복 제거). 미설정이면 빈 배열. */
export function demoConsoleEmails(config: ConfigService): string[] {
  const raw = config.get<string>(DEMO_CONSOLE_EMAILS_ENV, '');
  return [
    ...new Set(
      raw
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}
