import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  WITHDRAWAL_REASONS,
  type WithdrawUserDto as WithdrawUserShape,
  type WithdrawalReasonCode,
} from '@tripick/types';

const REASON_CODES = WITHDRAWAL_REASONS.map(({ code }) => code);

/** POST /users/me/withdrawal 요청 본문. 확인 문구 일치 여부는 서비스에서 판정한다. */
export class WithdrawUserDto implements WithdrawUserShape {
  @IsOptional()
  @IsIn(REASON_CODES, { message: `reason 은 ${REASON_CODES.join(', ')} 중 하나여야 합니다.` })
  reason?: WithdrawalReasonCode;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonDetail?: string;

  @IsString()
  confirmation: string;
}
