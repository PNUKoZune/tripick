import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * FCM 토큰 등록·해제 요청.
 *
 * 예전에는 컨트롤러가 `@Body('fcmToken')`·`@Query('fcmToken')` 로 원시 값을 받아
 * **전역 ValidationPipe 를 타지 않았다** — 길이 제한도 타입 검사도 없이 그대로
 * `fcm_tokens.token` 에 들어갔고, 문자열이 아닌 값이 오면 서비스의 `token.trim()` 에서
 * 터져 500 이 났다. DTO 로 고정해 파이프를 실제로 태운다.
 *
 * 등록 토큰은 보통 150~200자지만 FCM 이 길이를 보장하지 않아 상한은 넉넉히 둔다 —
 * 짧게 잡으면 정상 토큰이 거절돼 그 기기가 푸시를 영구히 못 받는다.
 */
const FCM_TOKEN_MIN_LENGTH = 10;
const FCM_TOKEN_MAX_LENGTH = 4096;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** 진단·세분화용 값. 엔티티 주석이 정의한 세 가지만 받는다. */
export const FCM_PLATFORMS = ['android', 'ios', 'web'] as const;

class FcmTokenBody {
  @Transform(trim)
  @IsString()
  @MinLength(FCM_TOKEN_MIN_LENGTH, { message: 'FCM 토큰이 올바르지 않습니다.' })
  @MaxLength(FCM_TOKEN_MAX_LENGTH, { message: 'FCM 토큰이 올바르지 않습니다.' })
  fcmToken: string;
}

export class UpdateFcmTokenBodyDto extends FcmTokenBody {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsIn(FCM_PLATFORMS, { message: `platform 은 ${FCM_PLATFORMS.join(', ')} 중 하나여야 합니다.` })
  platform?: string;
}

/** 해제는 쿼리스트링으로 온다(DELETE 본문 없음). 검증 규칙은 등록과 같다. */
export class RemoveFcmTokenQueryDto extends FcmTokenBody {}
