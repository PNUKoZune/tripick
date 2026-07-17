import { IsString, MaxLength, MinLength } from 'class-validator';
import type { AddFriendRequestDto } from '@tripick/types';

export class AddFriendRequestBodyDto implements AddFriendRequestDto {
  // 서비스가 handle 을 정규화(trim·'@' 처리)하므로 문자열이 아니면 그 지점에서 터진다.
  // 빈 문자열·공백만 있는 값은 서비스가 안내 메시지와 함께 400 으로 돌려준다.
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  handle!: string;
}
