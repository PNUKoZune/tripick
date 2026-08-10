import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { CreateTripDto, RouteMode, TripStatus, UpdateTripDto } from '@tripick/types';
import { HH_MM, YYYY_MM_DD } from '../../common/validation/patterns';

const ROUTE_MODES = ['walk', 'transit', 'car'] as const satisfies readonly RouteMode[];
const TRIP_STATUSES = [
  'draft',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
] as const satisfies readonly TripStatus[];

export class CreateTripBodyDto implements CreateTripDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  destination!: string;

  @Matches(YYYY_MM_DD)
  startDate!: string;

  @Matches(YYYY_MM_DD)
  endDate!: string;

  @IsOptional()
  @Matches(HH_MM)
  sleepTime?: string;

  @IsOptional()
  @Matches(HH_MM)
  wakeTime?: string;

  @IsOptional()
  @IsIn(ROUTE_MODES)
  transportMode?: RouteMode;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateTripBodyDto implements UpdateTripDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsIn(TRIP_STATUSES)
  status?: TripStatus;

  @IsOptional()
  @Matches(HH_MM)
  sleepTime?: string;

  @IsOptional()
  @Matches(HH_MM)
  wakeTime?: string;

  @IsOptional()
  @IsIn(ROUTE_MODES)
  transportMode?: RouteMode;

  // null 은 메모 삭제를 뜻하므로 통과시키고, 문자열일 때만 길이를 본다.
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
