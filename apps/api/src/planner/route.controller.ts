import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Coordinates, RouteEtaDto, RouteTransportMode } from '@tripick/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RouteHelper } from './helpers/route.helper';

/**
 * 두 좌표 간 실시간 ETA 조회. Live 화면이 "현재 위치 → 다음 장소" 를
 * 주기적으로 폴링할 때 사용한다. 출발이 "지금"이라 departAt 은 넘기지 않는다
 * (OTP 가 현재 시각 시간표로 계산). OTP 미가동/실패 시 RouteHelper 가
 * 직선거리 추정으로 폴백하므로 항상 값이 반환된다.
 */
@ApiTags('Routes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('routes')
export class RouteController {
  constructor(private readonly routeHelper: RouteHelper) {}

  @Get('eta')
  @ApiOperation({ summary: '두 좌표 간 실시간 ETA (Live 화면 폴링용)' })
  async eta(
    @Query('fromLat') fromLat: string,
    @Query('fromLng') fromLng: string,
    @Query('toLat') toLat: string,
    @Query('toLng') toLng: string,
    @Query('mode') mode: string,
  ): Promise<RouteEtaDto> {
    const from = this.parseCoord(fromLat, fromLng, 'from');
    const to = this.parseCoord(toLat, toLng, 'to');
    const eta = await this.routeHelper.getEta(from, to, this.parseMode(mode));
    return { durationSec: eta.durationSec, distanceM: eta.distanceM };
  }

  /** 위경도 파싱 + 지구 범위 검증. 범위를 벗어나면 그럴듯한 가짜 ETA 대신 400 을 낸다. */
  private parseCoord(lat: string, lng: string, field: string): Coordinates {
    const parsed = { lat: Number(lat), lng: Number(lng) };
    const valid =
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng) &&
      Math.abs(parsed.lat) <= 90 &&
      Math.abs(parsed.lng) <= 180;
    if (!valid) {
      throw new BadRequestException(
        `${field}Lat/${field}Lng 는 유효한 위경도(lat ±90, lng ±180)여야 합니다.`,
      );
    }
    return parsed;
  }

  /** mode 화이트리스트. 오타가 조용히 transit 으로 처리되지 않도록 400 을 낸다. */
  private parseMode(mode: string): RouteTransportMode {
    if (mode === 'car' || mode === 'transit' || mode === 'walk') return mode;
    throw new BadRequestException('mode 는 car | transit | walk 여야 합니다.');
  }
}
