import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
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

const REPLAN_TRIGGERS = ['deviation', 'weather', 'manual'] as const satisfies readonly ReplanTrigger[];
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
  deviatedItemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

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

export class AlternativeReplanRequestBodyDto extends BaseReplanRequestBodyDto {
  @IsOptional()
  @IsIn(REPLAN_TRIGGERS)
  trigger?: ReplanTrigger;
}
