import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserEntity } from '../users/user.entity';
import { LiveLocationService } from './live-location.service';
import { UpdateLiveLocationDto } from './dto/update-live-location.dto';

/**
 * 여행 진행(Live) 중 클라이언트가 현재 위치를 주기적으로 보고하는 엔드포인트.
 * 서버는 위치를 캐시만 하고, 판정·알림은 ArrivalAlert 스캔 잡이 담당한다.
 */
@ApiTags('LiveLocation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('live')
export class LiveLocationController {
  constructor(private readonly liveLocation: LiveLocationService) {}

  @Post('location')
  @HttpCode(204)
  @ApiOperation({ summary: '현재 위치 보고 (미도착 감지용 캐시)' })
  async report(@CurrentUser() user: UserEntity, @Body() dto: UpdateLiveLocationDto): Promise<void> {
    await this.liveLocation.record(user.id, {
      lat: dto.lat,
      lng: dto.lng,
      ...(dto.accuracy !== undefined ? { accuracy: dto.accuracy } : {}),
    });
  }
}
