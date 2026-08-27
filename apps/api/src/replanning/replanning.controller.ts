import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LLM_GENERATION_LIMIT } from '../common/throttle';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserEntity } from '../users/user.entity';
import { ReplanningService } from './replanning.service';
import { ReplanRequestBodyDto } from './dto/replan-request.dto';

@ApiTags('Replanning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('replanning')
export class ReplanningController {
  constructor(private readonly replanningService: ReplanningService) {}

  @Post()
  // 재계획 잡도 LLM 으로 일정을 다시 만든다. 중복 제출은 서비스가 dedup 하지만,
  // 서로 다른 일차를 번갈아 던지면 dedup 을 비껴가므로 라우트에서도 막는다.
  @Throttle(LLM_GENERATION_LIMIT)
  @ApiOperation({ summary: '재계획 요청 (BullMQ 잡 등록)' })
  requestReplan(@CurrentUser() user: UserEntity, @Body() dto: ReplanRequestBodyDto) {
    return this.replanningService.enqueue(user.id, dto);
  }
}
