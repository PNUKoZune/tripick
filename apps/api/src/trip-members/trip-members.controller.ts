import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserEntity } from '../users/user.entity';
import { TripMembersService } from './trip-members.service';
import type { CreateTripMemberDto, UpdateTripMemberDto } from '@tripick/types';

@ApiTags('Trip members')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trips/:tripId')
export class TripMembersController {
  constructor(private readonly tripMembersService: TripMembersService) {}

  @Get('members')
  @ApiOperation({ summary: '여행 멤버 목록 조회' })
  findAll(@CurrentUser() user: UserEntity, @Param('tripId') tripId: string) {
    return this.tripMembersService.findAll(tripId, user);
  }

  @Post('members')
  @ApiOperation({ summary: '여행 멤버 추가' })
  create(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Body() dto: CreateTripMemberDto,
  ) {
    return this.tripMembersService.create(tripId, user.id, dto);
  }

  @Patch('members/:memberId')
  @ApiOperation({ summary: '여행 멤버 수정' })
  update(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateTripMemberDto,
  ) {
    return this.tripMembersService.update(tripId, memberId, user.id, dto);
  }

  @Delete('members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '여행 멤버 삭제' })
  remove(
    @CurrentUser() user: UserEntity,
    @Param('tripId') tripId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.tripMembersService.remove(tripId, memberId, user.id);
  }

  @Get('preference-coordination')
  @ApiOperation({ summary: '여행 멤버 취향 조율 결과 조회' })
  coordination(@CurrentUser() user: UserEntity, @Param('tripId') tripId: string) {
    return this.tripMembersService.getCoordination(tripId, user);
  }
}
