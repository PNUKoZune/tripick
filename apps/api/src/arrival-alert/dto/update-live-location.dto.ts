import { IsLatitude, IsLongitude, IsNumber, IsOptional, Max, Min } from 'class-validator';
import type { UpdateLiveLocationDto as UpdateLiveLocationShape } from '@tripick/types';

/** POST /live/location 요청 본문. */
export class UpdateLiveLocationDto implements UpdateLiveLocationShape {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  accuracy?: number;
}
