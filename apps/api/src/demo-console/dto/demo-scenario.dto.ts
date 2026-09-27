import { IsInt, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { DemoScenarioRequestDto as DemoScenarioRequestShape } from '@tripick/types';

/** 시연 시나리오 실행 요청 본문. 전부 선택값이며, 비우면 서버가 시연 대상을 자동 선택한다. */
export class DemoScenarioDto implements DemoScenarioRequestShape {
  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  day?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.6)
  @Max(500)
  distanceKm?: number;
}
