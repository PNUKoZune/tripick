import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type {
  CreateTripRequestDto,
  PlannerAddItemRequestDto,
  PlannerItemType,
  PlannerMemberDto,
  PlannerReorderItemsRequestDto,
  PlannerResolvePlaceRequestDto,
  PlannerSwapPlaceDto,
  PlannerSwapRequestDto,
  PlannerUpdateItemRequestDto,
} from '@tripick/types';

class PlannerMemberBodyDto implements PlannerMemberDto {
  @IsString()
  @MinLength(1)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4)
  initial!: string;

  @IsString()
  @MinLength(1)
  color!: string;

  @IsOptional()
  @IsString()
  friendId?: string | null;

  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsIn(['owner', 'companion'])
  role?: 'owner' | 'companion';

  @IsOptional()
  @IsIn(['accepted', 'pending'])
  status?: 'accepted' | 'pending';
}

export class CreateTripRequestBodyDto implements CreateTripRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  destination!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

  @Matches(/^\d{2}:\d{2}$/)
  startTime!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate!: string;

  @Matches(/^\d{2}:\d{2}$/)
  endTime!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlannerMemberBodyDto)
  members!: PlannerMemberBodyDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

class PlannerSwapPlaceBodyDto implements PlannerSwapPlaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsIn(['attraction', 'restaurant', 'cafe', 'transport'])
  category?: PlannerItemType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsNumber()
  @IsLatitude()
  lat!: number;

  @IsNumber()
  @IsLongitude()
  lng!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  mapHref?: string;
}

export class PlannerSwapRequestBodyDto implements PlannerSwapRequestDto {
  @IsUUID()
  itemId!: string;

  @ValidateNested()
  @Type(() => PlannerSwapPlaceBodyDto)
  place!: PlannerSwapPlaceBodyDto;
}

export class PlannerResolvePlaceBodyDto implements PlannerResolvePlaceRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  query!: string;
}

export class AddTripMemberRequestBodyDto {
  @IsUUID()
  friendId!: string;
}

export class PlannerAddItemBodyDto implements PlannerAddItemRequestDto {
  @IsInt()
  @Min(1)
  day!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @Matches(/^\d{2}:\d{2}$/)
  scheduledAt!: string;

  @IsOptional()
  @IsIn(['attraction', 'restaurant', 'cafe', 'transport'])
  type?: PlannerItemType;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  durationMin?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsNumber()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsNumber()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;
}

export class PlannerUpdateItemBodyDto implements PlannerUpdateItemRequestDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  scheduledAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  durationMin?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;
}

export class PlannerReorderItemsBodyDto implements PlannerReorderItemsRequestDto {
  @IsInt()
  @Min(1)
  day!: number;

  @IsArray()
  @IsUUID('4', { each: true })
  orderedItemIds!: string[];
}
