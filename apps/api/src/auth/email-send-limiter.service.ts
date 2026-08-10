import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { redisConnection } from '../common/redis.config';

const KEY_PREFIX = 'auth:mail-limit:';
/** 주소 하나당 허용량. 정상 재시도(메일 안 옴 → 몇 번 더)는 넉넉히 통과할 정도로 잡는다. */
const MAX_PER_WINDOW = 5;
const WINDOW_SEC = 60 * 60;

export type MailPurpose = 'verify' | 'reset';

/**
 * 메일 발송을 **수신 주소 기준**으로 제한한다.
 *
 * 라우트의 `@Throttle` 은 IP 기준이라, IP 를 갈아 가며 같은 주소로 요청하면 한 사람의
 * 메일함에 계속 메일이 꽂힌다. 여기서 주소별로 한 번 더 센다.
 *
 * 카운트는 **계정 존재 여부와 무관하게** 올린다 — 실제로 보낼 때만 세면 429 가 곧
 * "그 주소는 가입돼 있음" 신호가 돼서, enumeration 을 막아 둔 게 무의미해진다.
 *
 * Redis 장애 시에는 통과시킨다(fail-open). 부가 방어가 죽었다고 비밀번호 재설정 자체를
 * 막을 이유는 없고, IP 기준 제한은 그대로 살아 있다.
 */
@Injectable()
export class EmailSendLimiterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailSendLimiterService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(redisConnection(config, { lazyConnect: true, maxRetriesPerRequest: 1 }));
    this.redis.on('error', () => undefined);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.connect();
    } catch (error) {
      this.logger.warn(`Redis 연결 실패 — 주소별 메일 제한이 비활성화된다: ${(error as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  /**
   * 이번 요청을 한도에 반영하고 결과를 돌려준다. 429 응답·헤더는 호출부(컨트롤러)가 만든다 —
   * 여기서 HTTP 를 알 필요가 없고, 헤더를 붙이려면 어차피 Response 가 필요하다.
   */
  async consume(email: string, purpose: MailPurpose): Promise<{ allowed: boolean; retryAfter: number }> {
    const key = `${KEY_PREFIX}${purpose}:${email}`;
    let count: number;
    try {
      count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, WINDOW_SEC);
    } catch {
      return { allowed: true, retryAfter: 0 }; // fail-open
    }
    if (count <= MAX_PER_WINDOW) return { allowed: true, retryAfter: 0 };

    const ttl = await this.redis.ttl(key).catch(() => WINDOW_SEC);
    return { allowed: false, retryAfter: ttl > 0 ? ttl : WINDOW_SEC };
  }
}
