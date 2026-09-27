import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { DemoScenarioRequestDto as DemoScenarioRequestShape } from '@tripick/types';

/**
 * 시연 시나리오 실행 요청. 전부 선택값이며, 비우면 서버가 시연 대상을 자동 선택한다.
 *
 * 상태 조회(GET)의 쿼리스트링으로도 쓰이므로 숫자 필드에 `@Type(() => Number)` 가 필요하다 —
 * 쿼리는 전부 문자열로 들어와 변환 없이는 `@IsInt` 에서 튕긴다.
 */
export class DemoScenarioDto implements DemoScenarioRequestShape {
  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  day?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.6)
  @Max(500)
  distanceKm?: number;
}
