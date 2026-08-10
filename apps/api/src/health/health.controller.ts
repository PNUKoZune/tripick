import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

/**
 * 배포 헬스체크(Railway 등)용 라이브니스 엔드포인트. GET /api/v1/health.
 *
 * DB·Redis 등 의존성 상태는 확인하지 않는다 — 의존성 일시 장애로 헬스체크가
 * 흔들려 인스턴스가 계속 재시작되는 것을 막기 위해, 프로세스 생존만 알린다.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @SkipThrottle()
  @ApiOperation({ summary: '라이브니스 체크' })
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
