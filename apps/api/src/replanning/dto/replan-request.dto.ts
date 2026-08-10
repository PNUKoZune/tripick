import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  ReplanBudget,
  ReplanPace,
  ReplanPlaceDto,
  ReplanPreferencesDto,
  ReplanRequestDto,
  ReplanTrigger,
} from '@tripick/types';

const REPLAN_TRIGGERS = [
  'deviation',
  'weather',
  'crowd',
  'manual',
] as const satisfies readonly ReplanTrigger[];
const REPLAN_PACE = ['relaxed', 'balanced', 'packed'] as const satisfies readonly ReplanPace[];
const REPLAN_BUDGET = ['thrifty', 'normal', 'premium'] as const satisfies readonly ReplanBudget[];

export class ReplanLocationBodyDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}

export class ReplanPlaceBodyDto implements ReplanPlaceDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  lng!: number;
}

export class ReplanPreferencesBodyDto implements ReplanPreferencesDto {
  @IsOptional()
  @IsIn(REPLAN_PACE)
  pace?: ReplanPace;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  avoid?: string;

  @IsOptional()
  @IsBoolean()
  minimizeTravel?: boolean;

  @IsOptional()
  @IsIn(REPLAN_BUDGET)
  budget?: ReplanBudget;
}

export class BaseReplanRequestBodyDto implements Omit<ReplanRequestDto, 'trigger'> {
  @IsUUID()
  tripId!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReplanLocationBodyDto)
  currentLocation?: ReplanLocationBodyDto;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  /**
   * 재계획할 일차(1-based). 생략하면 전체 일정. 상한은 여행 일수를 모르는 시점이라
   * 넉넉히 두고(31), 여행 범위를 벗어난 일차는 PlannerService 가 잘라낸다.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(31)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  targetDays?: number[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReplanPlaceBodyDto)
  mustIncludePlaces?: ReplanPlaceBodyDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ReplanPreferencesBodyDto)
  preferences?: ReplanPreferencesBodyDto;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

export class ReplanRequestBodyDto extends BaseReplanRequestBodyDto implements ReplanRequestDto {
  @IsIn(REPLAN_TRIGGERS)
  trigger!: ReplanTrigger;
}

/**
 * `/alternative/*` 바디. trigger 는 선택값이다 —
 * `/request` 는 실려 오면 그대로 쓰고(알림 배너에서 연 재계획의 weather·crowd·deviation),
 * 없으면 manual. `/deviation` 은 이탈 신고 전용이라 항상 deviation 으로 고정한다.
 */
export class AlternativeReplanRequestBodyDto extends BaseReplanRequestBodyDto {
  @IsOptional()
  @IsIn(REPLAN_TRIGGERS)
  trigger?: ReplanTrigger;
}
