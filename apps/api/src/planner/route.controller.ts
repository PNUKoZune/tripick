import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RouteEtaDto } from '@tripick/types';
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
    const from = { lat: Number(fromLat), lng: Number(fromLng) };
    const to = { lat: Number(toLat), lng: Number(toLng) };
    if ([from.lat, from.lng, to.lat, to.lng].some((v) => !Number.isFinite(v))) {
      throw new BadRequestException('fromLat/fromLng/toLat/toLng 는 숫자여야 합니다.');
    }

    const eta =
      mode === 'car'
        ? await this.routeHelper.getDrivingEta(from, to)
        : await this.routeHelper.getTransitEta(from, to);

    return { durationSec: eta.durationSec, distanceM: eta.distanceM };
  }
}
