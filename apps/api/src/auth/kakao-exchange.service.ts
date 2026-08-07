import { Injectable, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import type { LoginResponseDto } from '@tripick/types';
import { redisConnection } from '../common/redis.config';

const KEY_PREFIX = 'auth:kakao:exchange:';
/** 콜백 화면이 즉시 교환한다. 짧을수록 좋고, 웹뷰 로딩 지연만 견디면 된다. */
const EXCHANGE_TTL_SEC = 120;

/**
 * 카카오 로그인 결과를 1회용 코드 뒤에 숨긴다.
 *
 * 예전에는 세션(access + **refresh** 토큰)을 통째로 base64 로 만들어 리다이렉트 URL 프래그먼트에
 * 실어 보냈다. 프래그먼트는 서버로 안 가지만 브라우저 히스토리·확장 프로그램·화면 공유에는
 * 그대로 남아, 30일짜리 refresh 토큰이 URL 로 굴러다니는 셈이었다. 이제 URL 에는 2분짜리
 * 1회용 코드만 싣고, 실제 토큰은 웹이 POST 로 바꿔 간다.
 *
 * 저장소는 Redis — 코드를 발급한 인스턴스와 교환을 받는 인스턴스가 다를 수 있다.
 */
@Injectable()
export class KakaoExchangeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KakaoExchangeService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(redisConnection(config, { lazyConnect: true, maxRetriesPerRequest: 1 }));
    this.redis.on('error', () => undefined);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.connect();
    } catch (error) {
      // 부팅은 막지 않는다 — 이메일 로그인은 Redis 없이도 돌아야 한다.
      this.logger.warn(`Redis 연결 실패 — 카카오 로그인 교환이 동작하지 않는다: ${(error as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  async issue(session: LoginResponseDto): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    await this.redis.set(KEY_PREFIX + code, JSON.stringify(session), 'EX', EXCHANGE_TTL_SEC);
    return code;
  }

  /** 코드를 소비하고 세션을 돌려준다. GETDEL 이라 두 번째 교환은 실패한다. */
  async consume(code: string): Promise<LoginResponseDto> {
    const trimmed = (code ?? '').trim();
    if (!trimmed) throw new UnauthorizedException('로그인 코드가 없습니다.');
    const raw = await this.redis.getdel(KEY_PREFIX + trimmed);
    if (!raw) {
      throw new UnauthorizedException('로그인 코드가 만료됐거나 이미 사용됐습니다. 다시 로그인해주세요.');
    }
    return JSON.parse(raw) as LoginResponseDto;
  }
}
