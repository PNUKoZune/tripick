import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MainPlannerService } from './main-planner.service';

/** 공개 공유 일정 조회 (인증 불필요). 공유 토큰만 있으면 누구나 읽기 전용으로 볼 수 있다. */
@ApiTags('Shared Itinerary')
@Controller('shared-itineraries')
export class SharedItineraryController {
  constructor(private readonly mainPlannerService: MainPlannerService) {}

  @Get(':token')
  @ApiOperation({ summary: '공유 토큰으로 읽기 전용 일정 조회 (public)' })
  getShared(@Param('token') token: string) {
    return this.mainPlannerService.getSharedItinerary(token);
  }
}
