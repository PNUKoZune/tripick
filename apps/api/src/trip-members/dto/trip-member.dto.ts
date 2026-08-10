import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type {
  CreateTripMemberDto,
  RouteMode,
  TripBudgetLevel,
  TripMemberPreferenceDto,
  TripMemberStatus,
  UpdateTripMemberDto,
} from '@tripick/types';

const MEMBER_STATUSES = ['accepted', 'pending'] as const satisfies readonly TripMemberStatus[];
const ROUTE_MODES = ['walk', 'transit', 'car'] as const satisfies readonly RouteMode[];
const BUDGET_LEVELS = ['low', 'medium', 'high'] as const satisfies readonly TripBudgetLevel[];

export class TripMemberPreferenceBodyDto implements Partial<TripMemberPreferenceDto> {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  food?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  mood?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  environment?: string[];

  @IsOptional()
  @IsIn(ROUTE_MODES)
  transportMode?: RouteMode;

  @IsOptional()
  @IsIn(BUDGET_LEVELS)
  budgetLevel?: TripBudgetLevel;
}

export class CreateTripMemberBodyDto implements CreateTripMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  nickname!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  kakaoId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  relation?: string;

  @IsOptional()
  @IsIn(MEMBER_STATUSES)
  status?: TripMemberStatus;

  @IsOptional()
  @ValidateNested()
  @Type(() => TripMemberPreferenceBodyDto)
  preferenceTags?: TripMemberPreferenceBodyDto;
}

/** null 은 값 삭제를 뜻하므로 통과시키고, 문자열일 때만 형식을 본다. */
export class UpdateTripMemberBodyDto implements UpdateTripMemberDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  nickname?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(120)
  contact?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(60)
  kakaoId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(40)
  relation?: string | null;

  @IsOptional()
  @IsIn(MEMBER_STATUSES)
  status?: TripMemberStatus;

  @IsOptional()
  @ValidateNested()
  @Type(() => TripMemberPreferenceBodyDto)
  preferenceTags?: TripMemberPreferenceBodyDto;
}
