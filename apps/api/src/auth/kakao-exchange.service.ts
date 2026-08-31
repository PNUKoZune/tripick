import { Injectable, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { KakaoProfile, LoginResponseDto } from '@tripick/types';
import { redisConnection } from '../common/redis.config';

const KEY_PREFIX = 'auth:kakao:exchange:';
/** 콜백 화면이 즉시 교환한다. 짧을수록 좋고, 웹뷰 로딩 지연만 견디면 된다. */
const EXCHANGE_TTL_SEC = 120;

/**
 * 신규 가입자의 약관 동의 대기표. 세션 코드와 **저장소를 분리한다** — 한 통에 섞으면
 * 동의용 코드로 세션 교환을 시도하는 식의 혼동이 코드 경로가 아니라 데이터에서 갈린다.
 */
const SIGNUP_KEY_PREFIX = 'auth:kakao:signup:';
/** 사람이 약관을 읽고 누르는 시간. 교환 코드(2분)보다 넉넉해야 한다. */
const SIGNUP_TTL_SEC = 10 * 60;

/**
 * 카카오 로그인 결과를 1회용 코드 뒤에 숨긴다.
 *
 * 예전에는 세션(access + **refresh** 토큰)을 통째로 base64 로 만들어 리다이렉트 URL 프래그먼트에
 * 실어 보냈다. 프래그먼트는 서버로 안 가지만 브라우저 히스토리·확장 프로그램·화면 공유에는
 * 그대로 남아, 30일짜리 refresh 토큰이 URL 로 굴러다니는 셈이었다. 이제 URL 에는 2분짜리
 * 1회용 코드만 싣고, 실제 토큰은 웹이 POST 로 바꿔 간다.
 *
 * 저장소는 Redis — 코드를 발급한 인스턴스와 교환을 받는 인스턴스가 다를 수 있다.
 *
 * 코드에는 **로그인을 시작한 브라우저의 bind 비밀 해시**가 함께 실린다. 코드만으로 교환이
 * 되면 코드는 곧 세션이라, 공격자가 자기 로그인으로 얻은 코드를 피해자에게 링크로 던져
 * 피해자를 공격자 계정에 로그인시킬 수 있다(로그인 CSRF). 시작 단계의 `state` 는 카카오
 * 왕복만 보호하므로 이 마지막 홉은 여기서 막는다.
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

  /**
   * 세션을 1회용 코드 뒤에 넣는다. `bindSecret` 은 로그인을 시작한 브라우저가 들고 있는
   * 값으로, 해시만 저장한다 — Redis 를 들여다볼 수 있는 쪽에도 원본을 남기지 않는다.
   */
  async issue(session: LoginResponseDto, bindSecret: string): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    const record: ExchangeRecord = { session, bindHash: sha256(bindSecret) };
    await this.redis.set(KEY_PREFIX + code, JSON.stringify(record), 'EX', EXCHANGE_TTL_SEC);
    return code;
  }

  /** 코드를 소비하고 세션을 돌려준다. GETDEL 이라 두 번째 교환은 실패한다. */
  async consume(code: string, bindSecret: string): Promise<LoginResponseDto> {
    const trimmed = (code ?? '').trim();
    if (!trimmed) throw new UnauthorizedException('로그인 코드가 없습니다.');
    const raw = await this.redis.getdel(KEY_PREFIX + trimmed);
    if (!raw) {
      throw new UnauthorizedException('로그인 코드가 만료됐거나 이미 사용됐습니다. 다시 로그인해주세요.');
    }
    const record = JSON.parse(raw) as ExchangeRecord;
    this.assertBind(record.bindHash, bindSecret);
    return record.session;
  }

  /**
   * 아직 계정이 없는 카카오 프로필을 대기표 뒤에 넣는다. 동의 화면이 끝나면
   * {@link consumeSignupTicket} 으로 되찾아 그때 계정을 만든다.
   */
  async issueSignupTicket(profile: KakaoProfile, bindSecret: string): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    const record: SignupRecord = { profile, bindHash: sha256(bindSecret) };
    await this.redis.set(SIGNUP_KEY_PREFIX + code, JSON.stringify(record), 'EX', SIGNUP_TTL_SEC);
    return code;
  }

  /** 대기표를 소비하고 프로필을 돌려준다. 세션 코드와 마찬가지로 1회용이다. */
  async consumeSignupTicket(code: string, bindSecret: string): Promise<KakaoProfile> {
    const trimmed = (code ?? '').trim();
    if (!trimmed) throw new UnauthorizedException('가입 코드가 없습니다.');
    const raw = await this.redis.getdel(SIGNUP_KEY_PREFIX + trimmed);
    if (!raw) {
      throw new UnauthorizedException('가입 절차가 만료됐어요. 카카오 로그인부터 다시 해주세요.');
    }
    const record = JSON.parse(raw) as SignupRecord;
    this.assertBind(record.bindHash, bindSecret);
    return record.profile;
  }

  /**
   * bind 가 안 맞으면 코드는 **소비된 채로** 거절된다 — 일부러 그렇게 둔다. 남겨 두면
   * 공격자가 피해자에게 코드를 던져 실패시킨 뒤 자기가 다시 쓰는 재시도 창이 열린다.
   */
  private assertBind(bindHash: string | undefined, bindSecret: string): void {
    if (matchesHash(bindHash, bindSecret)) return;
    this.logger.warn('카카오 코드의 bind 불일치 — 다른 브라우저가 제시한 코드를 거절했다');
    throw new UnauthorizedException(
      '이 브라우저에서 시작한 로그인이 아니에요. 처음부터 다시 로그인해주세요.',
    );
  }
}

/** Redis 에 저장되는 교환 레코드. */
interface ExchangeRecord {
  session: LoginResponseDto;
  /** 로그인을 시작한 브라우저의 bind 비밀 sha256. */
  bindHash: string;
}

/** 약관 동의 전까지 계정 대신 들고 있는 카카오 프로필. */
interface SignupRecord {
  profile: KakaoProfile;
  bindHash: string;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 길이가 고정(sha256 hex)이라 timingSafeEqual 을 그대로 쓸 수 있다. */
function matchesHash(expectedHash: string | undefined, secret: string): boolean {
  const provided = (secret ?? '').trim();
  if (!expectedHash || !provided) return false;
  const a = Buffer.from(expectedHash);
  const b = Buffer.from(sha256(provided));
  return a.length === b.length && timingSafeEqual(a, b);
}
