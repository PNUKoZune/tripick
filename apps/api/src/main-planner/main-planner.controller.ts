import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserEntity } from '../users/user.entity';
import { searchDestinationFallbacks } from './destinations.fallback';
import { MainPlannerService } from './main-planner.service';
import {
  AddTripMemberRequestBodyDto,
  CreateTripRequestBodyDto,
  PlannerSwapRequestBodyDto,
} from './dto/main-planner.dto';

@ApiTags('Main Planner')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('main-planner')
export class MainPlannerController {
  constructor(private readonly mainPlannerService: MainPlannerService) {}

  @Get('trips')
  @ApiOperation({ summary: '내 여행 목록' })
  listTrips(@CurrentUser() user: UserEntity) {
    return this.mainPlannerService.listTrips(user);
  }

  @Get('destinations')
  @ApiOperation({ summary: '여행 지역 자동완성' })
  searchDestinations(@Query('q') q?: string) {
    return searchDestinationFallbacks(q ?? '');
  }

  @Post('trips')
  @ApiOperation({ summary: '신규 여행 생성 및 일정 생성' })
  createTrip(@CurrentUser() user: UserEntity, @Body() dto: CreateTripRequestBodyDto) {
    return this.mainPlannerService.createTrip(user, dto);
  }

  @Get('trips/:tripId')
  @ApiOperation({ summary: '메인 플래너 데이터' })
  getTrip(@CurrentUser() user: UserEntity, @Param('tripId') tripId: string) {
    return this.mainPlannerService.getTrip(user, tripId);
  }

  @Get('trips/:tripId/items/:itemId/alternatives')
  @ApiOperation({ summary: '일정 항목 대안 추천' })
  getAlternatives(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.mainPlannerService.getAlternatives(user, tripId, itemId);
  }

  @Get('trips/:tripId/coordination')
  @ApiOperation({ summary: '여행 취향 조율 결과' })
  getCoordination(@CurrentUser() user: UserEntity, @Param('tripId') tripId: string) {
    return this.mainPlannerService.getCoordination(user, tripId);
  }

  @Post('trips/:tripId/members')
  @ApiOperation({ summary: '여행 멤버로 친구 추가' })
  addMember(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Body() dto: AddTripMemberRequestBodyDto,
  ) {
    return this.mainPlannerService.addMember(user, tripId, dto);
  }

  @Delete('trips/:tripId/members/:memberId')
  @ApiOperation({ summary: '여행 멤버 제거 (owner)' })
  removeMember(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.mainPlannerService.removeMember(user, tripId, memberId);
  }

  @Patch('trips/:tripId/members/:memberId/accept-invite')
  @ApiOperation({ summary: '여행 초대 수락 (invitee)' })
  acceptInvite(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.mainPlannerService.acceptInvite(user, tripId, memberId);
  }

  @Delete('trips/:tripId/members/:memberId/invite')
  @HttpCode(204)
  @ApiOperation({ summary: '여행 초대 거절 (invitee)' })
  rejectInvite(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.mainPlannerService.rejectInvite(user, tripId, memberId);
  }

  @Post('trips/:tripId/swap')
  @HttpCode(200)
  @ApiOperation({ summary: '대안 선택 후 일정 항목 치환' })
  swap(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Body() dto: PlannerSwapRequestBodyDto,
  ) {
    return this.mainPlannerService.swap(user, tripId, dto);
  }
}
