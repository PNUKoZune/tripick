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
import { DestinationsService } from './destinations.service';
import { MainPlannerService } from './main-planner.service';
import {
  AddTripMemberRequestBodyDto,
  CreateTripRequestBodyDto,
  PlannerAddItemBodyDto,
  PlannerReorderItemsBodyDto,
  PlannerResolvePlaceBodyDto,
  PlannerSwapRequestBodyDto,
  PlannerUpdateItemBodyDto,
} from './dto/main-planner.dto';

@ApiTags('Main Planner')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('main-planner')
export class MainPlannerController {
  constructor(
    private readonly mainPlannerService: MainPlannerService,
    private readonly destinationsService: DestinationsService,
  ) {}

  @Get('trips')
  @ApiOperation({ summary: '내 여행 목록' })
  listTrips(@CurrentUser() user: UserEntity) {
    return this.mainPlannerService.listTrips(user);
  }

  @Get('destinations')
  @ApiOperation({ summary: '여행 지역 자동완성' })
  searchDestinations(@Query('q') q?: string) {
    return this.destinationsService.search(q ?? '');
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
  @ApiOperation({ summary: '일정 항목 대안 추천 (취향 기반 CRAG, note: 사용자 조건)' })
  getAlternatives(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Param('itemId') itemId: string,
    @Query('note') note?: string,
  ) {
    return this.mainPlannerService.getAlternatives(user, tripId, itemId, note);
  }

  @Post('trips/:tripId/items/:itemId/resolve-place')
  @HttpCode(200)
  @ApiOperation({ summary: '장소 이름 → 카카오 Local 실제 장소 해석 (확인용)' })
  resolvePlace(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Param('itemId') itemId: string,
    @Body() dto: PlannerResolvePlaceBodyDto,
  ) {
    return this.mainPlannerService.resolvePlace(user, tripId, itemId, dto.query);
  }

  @Get('trips/:tripId/coordination')
  @ApiOperation({ summary: '여행 취향 조율 결과' })
  getCoordination(@CurrentUser() user: UserEntity, @Param('tripId') tripId: string) {
    return this.mainPlannerService.getCoordination(user, tripId);
  }

  @Get('trips/:tripId/share')
  @ApiOperation({ summary: '공유 링크 상태 조회 (owner)' })
  getShareStatus(@CurrentUser() user: UserEntity, @Param('tripId') tripId: string) {
    return this.mainPlannerService.getShareStatus(user, tripId);
  }

  @Post('trips/:tripId/share')
  @HttpCode(200)
  @ApiOperation({ summary: '공유 링크 활성화 (owner)' })
  enableShare(@CurrentUser() user: UserEntity, @Param('tripId') tripId: string) {
    return this.mainPlannerService.enableShare(user, tripId);
  }

  @Delete('trips/:tripId/share')
  @HttpCode(204)
  @ApiOperation({ summary: '공유 링크 비활성화 (owner)' })
  disableShare(@CurrentUser() user: UserEntity, @Param('tripId') tripId: string) {
    return this.mainPlannerService.disableShare(user, tripId);
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

  @Post('trips/:tripId/items')
  @ApiOperation({ summary: '일정 항목 수동 추가' })
  addItem(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Body() dto: PlannerAddItemBodyDto,
  ) {
    return this.mainPlannerService.addItem(user, tripId, dto);
  }

  // :itemId 라우트보다 먼저 선언해야 "reorder" 가 itemId 로 잡히지 않는다
  @Patch('trips/:tripId/items/reorder')
  @HttpCode(200)
  @ApiOperation({ summary: '일정 항목 순서 변경 (드래그&드롭)' })
  reorderItems(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Body() dto: PlannerReorderItemsBodyDto,
  ) {
    return this.mainPlannerService.reorderItems(user, tripId, dto);
  }

  @Patch('trips/:tripId/items/:itemId')
  @ApiOperation({ summary: '일정 항목 수정 (시간·메모·이름·체류시간)' })
  updateItem(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Param('itemId') itemId: string,
    @Body() dto: PlannerUpdateItemBodyDto,
  ) {
    return this.mainPlannerService.updateItem(user, tripId, itemId, dto);
  }

  @Delete('trips/:tripId/items/:itemId')
  @HttpCode(204)
  @ApiOperation({ summary: '일정 항목 삭제' })
  deleteItem(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.mainPlannerService.deleteItem(user, tripId, itemId);
  }
}
