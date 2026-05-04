import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserEntity } from '../users/user.entity';
import { TripsService } from './trips.service';
import type { CreateTripDto, UpdateTripDto } from '@tripick/types';

@ApiTags('Trips')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get()
  @ApiOperation({ summary: '내 여행 목록 조회' })
  findAll(@CurrentUser() user: UserEntity) {
    return this.tripsService.findByUser(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '여행 상세 조회' })
  findOne(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.tripsService.findOne(id, user.id);
  }

  @Post()
  @ApiOperation({ summary: '여행 생성 (일정 자동 생성 트리거)' })
  create(@CurrentUser() user: UserEntity, @Body() dto: CreateTripDto) {
    return this.tripsService.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '여행 수정' })
  update(
    @CurrentUser() user: UserEntity,
    @Param('id') id: string,
    @Body() dto: UpdateTripDto,
  ) {
    return this.tripsService.update(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '여행 삭제' })
  remove(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.tripsService.remove(id, user.id);
  }
}
