import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserEntity } from '../users/user.entity';
import { ReplanningService } from './replanning.service';
import type { ReplanRequestDto } from '@tripick/types';

@ApiTags('Replanning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('replanning')
export class ReplanningController {
  constructor(private readonly replanningService: ReplanningService) {}

  @Post()
  @ApiOperation({ summary: '재계획 요청 (BullMQ 잡 등록)' })
  requestReplan(@CurrentUser() user: UserEntity, @Body() dto: ReplanRequestDto) {
    return this.replanningService.enqueue(user.id, dto);
  }
}
