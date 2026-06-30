import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ReplanRequestDto, ReplanTrigger } from '@tripick/types';

const REPLAN_TRIGGERS = ['waiting', 'deviation', 'weather', 'manual'] as const satisfies readonly ReplanTrigger[];

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

export class BaseReplanRequestBodyDto implements Omit<ReplanRequestDto, 'trigger'> {
  @IsUUID()
  tripId!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReplanLocationBodyDto)
  currentLocation?: ReplanLocationBodyDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(180)
  waitingMinutes?: number;

  @IsOptional()
  @IsString()
  deviatedItemId?: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

export class ReplanRequestBodyDto extends BaseReplanRequestBodyDto implements ReplanRequestDto {
  @IsIn(REPLAN_TRIGGERS)
  trigger!: ReplanTrigger;
}

export class AlternativeReplanRequestBodyDto extends BaseReplanRequestBodyDto {
  @IsOptional()
  @IsIn(REPLAN_TRIGGERS)
  trigger?: ReplanTrigger;
}
