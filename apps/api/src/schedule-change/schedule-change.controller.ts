import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserEntity } from '../users/user.entity';
import { CreateScheduleChangeBodyDto } from './dto/schedule-change.dto';
import { ScheduleChangeService } from './schedule-change.service';

@ApiTags('Schedule Change')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schedule-changes')
export class ScheduleChangeController {
  constructor(private readonly service: ScheduleChangeService) {}

  @Post()
  @ApiOperation({ summary: '일정 변경 제안 (비-owner 참여자)' })
  propose(@CurrentUser() user: UserEntity, @Body() dto: CreateScheduleChangeBodyDto) {
    return this.service.propose(user, dto);
  }

  @Get()
  @ApiOperation({ summary: '트립의 대기중 제안 목록 (owner: 전체 / 참여자: 본인)' })
  list(@CurrentUser() user: UserEntity, @Query('tripId') tripId: string) {
    return this.service.listForTrip(user, tripId);
  }

  @Get(':id')
  @ApiOperation({ summary: '제안 단건 조회 (owner diff 미리보기)' })
  getOne(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.service.getOne(user, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: '제안 승인 (owner) — 변경을 실제 반영' })
  approve(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.service.approve(user, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: '제안 거절 (owner)' })
  reject(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.service.reject(user, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '제안 취소 (요청자 본인)' })
  cancel(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.service.cancel(user, id);
  }
}
