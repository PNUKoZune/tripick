import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FcmTokenEntity } from './fcm-token.entity';

/**
 * FCM 토큰 저장소. 등록(upsert)·조회·삭제만 담당하고 실제 발송은 NotificationService 가 한다.
 */
@Injectable()
export class FcmTokenService {
  private readonly logger = new Logger(FcmTokenService.name);

  constructor(
    @InjectRepository(FcmTokenEntity)
    private readonly repo: Repository<FcmTokenEntity>,
  ) {}

  /**
   * 토큰 등록/갱신. 토큰은 전역 유일이라, 같은 토큰이 다른 계정으로 재로그인되면
   * 소유 userId·platform 을 최신 값으로 덮어쓴다(upsert).
   */
  async register(userId: string, token: string, platform?: string | null): Promise<void> {
    const trimmed = token?.trim();
    if (!trimmed) return;
    await this.repo.upsert(
      { userId, token: trimmed, platform: platform ?? null },
      { conflictPaths: ['token'] },
    );
  }

  /** 사용자의 모든 디바이스 토큰. */
  async listTokens(userId: string): Promise<string[]> {
    const rows = await this.repo.find({ where: { userId }, select: { token: true } });
    return rows.map((row) => row.token);
  }

  /** 만료/무효 토큰 제거. NotificationService 가 발송 실패 시 호출. */
  async remove(token: string): Promise<void> {
    await this.repo.delete({ token });
    this.logger.debug(`removed fcm token ${token.slice(0, 12)}…`);
  }

  /**
   * 특정 사용자 소유의 토큰만 제거(로그아웃/계정 삭제 시). userId 로 스코프를 좁혀
   * 다른 사용자의 기기 토큰을 실수/악의로 지우는 것을 막는다.
   */
  async removeForUser(userId: string, token: string): Promise<void> {
    const trimmed = token?.trim();
    if (!trimmed) return;
    await this.repo.delete({ userId, token: trimmed });
  }
}
