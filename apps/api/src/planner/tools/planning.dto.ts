import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
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
import { MAX_PLANNING_ITEMS } from './planning.contract';

export class PlanningCoordinatesDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat!: number;
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng!: number;
}

export class PlanningContextDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PLANNING_ITEMS)
  @ArrayUnique()
  @IsString({ each: true })
  lockedItemIds?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PLANNING_ITEMS)
  @ArrayUnique()
  @IsString({ each: true })
  requiredItemIds?: string[];
  @IsOptional()
  @IsBoolean()
  refreshCandidates?: boolean;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PlanningCoordinatesDto)
  origin?: PlanningCoordinatesDto;
}

/** Placement fields are editable; supplied place metadata must match the snapshot. */
export class PlanningItemInputDto {
  @IsString() @MaxLength(200) id!: string;
  @IsInt() @Min(1) @Max(366) day!: number;
  @IsInt() @Min(1) @Max(MAX_PLANNING_ITEMS) order!: number;
  @IsDateString({ strict: true }) scheduledAt!: string;
  @IsInt() @Min(1) @Max(1440) durationMin!: number;
  @IsOptional() @IsString() tripId?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional()
  @IsIn(['attraction', 'restaurant', 'cafe', 'accommodation', 'transport'])
  type?: string;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PlanningCoordinatesDto)
  coordinates?: PlanningCoordinatesDto;
  @IsOptional() @IsString() openingHours?: string;
  @IsOptional() @IsString() phoneNumber?: string;
  @IsOptional() @IsString() kakaoPlaceId?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() memo?: string;
  @IsOptional() @IsInt() @Min(0) travelTimeMin?: number;
}

export class PlanningDraftDto {
  @IsUUID() snapshotId!: string;
  @IsString() @MaxLength(64) snapshotVersion!: string;
  @IsOptional() @IsUUID() candidateId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PLANNING_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => PlanningItemInputDto)
  items?: PlanningItemInputDto[];
}

export class PlanningOptimizeDto extends PlanningDraftDto {
  // The algorithm also clamps these for internal callers.
  @IsOptional() @IsInt() @Min(1) @Max(50) maxEvaluations?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2000) timeBudgetMs?: number;
}
