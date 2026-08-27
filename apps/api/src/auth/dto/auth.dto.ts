import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  NICKNAME_MAX_LENGTH,
  NICKNAME_REQUIRED,
  NICKNAME_TOO_LONG,
} from '../../users/nickname.constants';
import type {
  EmailLoginDto,
  EmailSignupDto,
  KakaoExchangeDto,
  RequestPasswordResetDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from '@tripick/types';

/**
 * `/auth/*` 요청 본문. 공유 타입은 인터페이스라 런타임에 사라져서, 전역 ValidationPipe
 * (`whitelist` + `forbidNonWhitelisted`)가 아무것도 검사하지 못했다 — 모르는 필드도 그대로
 * 통과했고 타입 검사도 없었다. 여기서 클래스로 고정해 파이프를 실제로 태운다.
 *
 * 의미 규칙(비밀번호 조합 등)은 서비스에도 그대로 남겨 둔다 — 컨트롤러를 안 거치는
 * 호출 경로에서도 규칙이 서야 하고, 사용자에게 보이는 문구도 서비스 쪽이 정본이다.
 */

/** 이메일은 대소문자·앞뒤 공백 차이로 계정이 갈리지 않게 입구에서 정규화한다. */
const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const EMAIL_MESSAGE = '올바른 이메일 형식이 아니에요.';
const TOKEN_MESSAGE = '토큰이 없어요.';

class EmailBody {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: EMAIL_MESSAGE })
  @MaxLength(254, { message: EMAIL_MESSAGE })
  email: string;
}

export class EmailSignupBodyDto extends EmailBody implements EmailSignupDto {
  // 길이만 본다 — 영문·숫자 조합 규칙은 서비스가 판정하고 문구도 거기서 나온다.
  @IsString()
  @MinLength(8, { message: '비밀번호는 8자 이상이어야 해요.' })
  @MaxLength(72, { message: '비밀번호는 72자 이내로 입력해주세요.' })
  password: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: NICKNAME_REQUIRED })
  @MaxLength(NICKNAME_MAX_LENGTH, { message: NICKNAME_TOO_LONG })
  nickname: string;
}

export class EmailLoginBodyDto extends EmailBody implements EmailLoginDto {
  // 로그인은 하한·조합 규칙을 걸지 않는다 — 규칙이 바뀌기 전에 만든 비밀번호도 로그인은 돼야 한다.
  // 상한만 둔다: 없으면 본문 한도(100KB)까지 아무 길이나 bcrypt 로 들어간다.
  // 값은 가입 상한(72)이 아니라 넉넉히 잡는다 — bcrypt 는 앞 72바이트만 쓰므로 그보다 긴
  // 비밀번호로 만든 계정도 해시는 같다. 72 로 자르면 그런 사용자가 로그인을 못 하게 된다.
  @IsString()
  @IsNotEmpty({ message: '비밀번호를 입력해주세요.' })
  @MaxLength(1024, { message: '비밀번호가 올바르지 않아요.' })
  password: string;
}

export class ResendVerificationBodyDto extends EmailBody implements ResendVerificationDto {}

export class RequestPasswordResetBodyDto extends EmailBody implements RequestPasswordResetDto {}

export class VerifyEmailBodyDto implements VerifyEmailDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: TOKEN_MESSAGE })
  @MaxLength(512, { message: TOKEN_MESSAGE })
  token: string;
}

export class ResetPasswordBodyDto extends VerifyEmailBodyDto implements ResetPasswordDto {
  @IsString()
  @MinLength(8, { message: '비밀번호는 8자 이상이어야 해요.' })
  @MaxLength(72, { message: '비밀번호는 72자 이내로 입력해주세요.' })
  password: string;
}

export class KakaoExchangeBodyDto implements KakaoExchangeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '로그인 코드가 없습니다.' })
  @MaxLength(512, { message: '로그인 코드가 올바르지 않습니다.' })
  code: string;

  // 로그인을 시작한 브라우저만 아는 값. 서버가 해시로 대조해 코드를 그 브라우저에 묶는다.
  // 길이 하한이 곧 추측 저항이라 형식까지 여기서 고정한다(컨트롤러 `isAcceptableBind` 와 같은 규칙).
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{32,256}$/, { message: '로그인 요청이 올바르지 않습니다.' })
  bind: string;
}

export class RefreshTokenBodyDto {
  @IsString()
  @IsNotEmpty({ message: '토큰이 없어요.' })
  @MaxLength(4096, { message: '토큰이 올바르지 않아요.' })
  refreshToken: string;
}

/** 로그아웃은 토큰이 없어도 통과시킨다 — 이미 세션이 없는 클라이언트도 정리를 시도한다. */
export class LogoutBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  refreshToken?: string;
}
