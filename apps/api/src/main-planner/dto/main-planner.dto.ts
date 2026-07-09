import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type {
  CreateTripRequestDto,
  PlannerItemType,
  PlannerMemberDto,
  PlannerResolveLinkRequestDto,
  PlannerSwapPlaceDto,
  PlannerSwapRequestDto,
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

export class PlannerResolveLinkBodyDto implements PlannerResolveLinkRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  url!: string;
}

export class AddTripMemberRequestBodyDto {
  @IsUUID()
  friendId!: string;
}
