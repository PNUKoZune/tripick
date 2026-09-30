import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserEntity } from '../users/user.entity';
import { DemoConsoleGuard } from './demo-console.guard';
import { DemoConsoleService } from './demo-console.service';
import { DemoScenarioDto } from './dto/demo-scenario.dto';

/**
 * 시연 콘솔 라우트. `DEMO_CONSOLE_ENABLED` 가 켜진 환경에서만 등록된다(DemoConsoleModule).
 *
 * 모든 라우트가 로그인 + 허용 계정(DemoConsoleGuard) 을 요구하며, 조작 대상은 그 계정의
 * 여행뿐이다. 알림 자체를 만들어 넣는 라우트는 없다 — 조건을 넣고 운영 스캐너를 부를 뿐이다.
 */
@ApiTags('DemoConsole')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, DemoConsoleGuard)
@Controller('demo')
export class DemoConsoleController {
  constructor(private readonly demoConsole: DemoConsoleService) {}

  @Get('status')
  @ApiOperation({ summary: '고를 수 있는 여행 목록 · 선택된 여행의 일정 · 주입된 위치 상태' })
  status(@CurrentUser() user: UserEntity, @Query() query: DemoScenarioDto) {
    return this.demoConsole.status(user, query);
  }

  @Post('trip')
  @HttpCode(200)
  @ApiOperation({ summary: '시연용 당일 여행 시드 (같은 제목 기존 시드는 교체)' })
  seedTrip(@CurrentUser() user: UserEntity) {
    return this.demoConsole.seedTrip(user);
  }

  @Post('scenarios/arrival')
  @HttpCode(200)
  @ApiOperation({ summary: '미도착 조건 주입 후 실제 미도착 스캔 실행' })
  runArrival(@CurrentUser() user: UserEntity, @Body() dto: DemoScenarioDto) {
    return this.demoConsole.runArrival(user, dto);
  }

  @Post('scenarios/weather')
  @HttpCode(200)
  @ApiOperation({ summary: '강수 예보 주입 후 실제 날씨 스캔 실행' })
  runWeather(@CurrentUser() user: UserEntity, @Body() dto: DemoScenarioDto) {
    return this.demoConsole.runWeather(user, dto);
  }

  @Post('scenarios/crowd')
  @HttpCode(200)
  @ApiOperation({ summary: '집중률 상승 주입 후 실제 혼잡 스캔 실행' })
  runCrowd(@CurrentUser() user: UserEntity, @Body() dto: DemoScenarioDto) {
    return this.demoConsole.runCrowd(user, dto);
  }

  @Post('reset')
  @HttpCode(200)
  @ApiOperation({ summary: '재시연 준비 — 주입 위치·알림 중복 억제 키 삭제' })
  reset(@CurrentUser() user: UserEntity, @Body() dto: DemoScenarioDto) {
    return this.demoConsole.reset(user, dto);
  }
}
