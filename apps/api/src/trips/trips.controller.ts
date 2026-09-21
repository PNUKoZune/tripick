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
import { Throttle } from '@nestjs/throttler';
import { LLM_GENERATION_LIMIT } from '../common/throttle';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserEntity } from '../users/user.entity';
import { TripsService } from './trips.service';
import { CreateTripBodyDto, UpdateTripBodyDto } from './dto/trip.dto';

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

  @Get(':id/generation')
  @ApiOperation({ summary: '초기 AI 일정 생성 작업 상태 조회' })
  generationStatus(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.tripsService.getGenerationStatus(id, user.id);
  }

  @Post(':id/generation/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(LLM_GENERATION_LIMIT)
  @ApiOperation({ summary: '최종 실패한 초기 AI 일정 생성 재시도' })
  retryGeneration(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.tripsService.retryGeneration(id, user.id);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  // 실제 LLM 처리는 큐에서 실행하지만 등록 폭주가 GPU 대기열을 무한히 늘리므로 제한은 유지한다.
  @Throttle(LLM_GENERATION_LIMIT)
  @ApiOperation({ summary: '여행 저장 및 초기 AI 일정 생성 큐 등록' })
  create(@CurrentUser() user: UserEntity, @Body() dto: CreateTripBodyDto) {
    return this.tripsService.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '여행 수정' })
  update(
    @CurrentUser() user: UserEntity,
    @Param('id') id: string,
    @Body() dto: UpdateTripBodyDto,
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
