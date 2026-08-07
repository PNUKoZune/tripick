import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { UpdateUserDto as UpdateUserShape } from '@tripick/types';

/**
 * `PATCH /users/me` 본문.
 *
 * `profileImageUrl` 은 일부러 받지 않는다. 전용 업로드·삭제 엔드포인트가 있는데도 이 경로로
 * 임의 URL 을 넣을 수 있어서, 외부 추적 URL 을 프로필 사진 자리에 앉힐 수 있었다. 이미지는
 * `POST/DELETE /users/me/profile-image` 로만 바뀐다.
 */
export class UpdateUserBodyDto implements UpdateUserShape {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: '닉네임을 입력해주세요.' })
  @MaxLength(20, { message: '닉네임은 20자 이내로 입력해주세요.' })
  nickname?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @Matches(/^[a-z0-9_]{3,20}$/, {
    message: '아이디는 영문 소문자·숫자·밑줄 3~20자로 입력해주세요.',
  })
  handle?: string;
}
