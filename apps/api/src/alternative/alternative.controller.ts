import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserEntity } from '../users/user.entity';
import { ReplanningService } from '../replanning/replanning.service';
import type { ReplanRequestDto } from '@tripick/types';

@ApiTags('Alternative')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('alternative')
export class AlternativeController {
  constructor(private readonly replanningService: ReplanningService) {}

  @Post('waiting')
  @ApiOperation({ summary: '웨이팅 신고 → 재계획 트리거' })
  reportWaiting(@CurrentUser() user: UserEntity, @Body() dto: ReplanRequestDto) {
    return this.replanningService.enqueue(user.id, {
      ...dto,
      trigger: 'waiting',
    });
  }

  @Post('deviation')
  @ApiOperation({ summary: '경로 이탈 신고 → 재계획 트리거' })
  reportDeviation(@CurrentUser() user: UserEntity, @Body() dto: ReplanRequestDto) {
    return this.replanningService.enqueue(user.id, {
      ...dto,
      trigger: 'deviation',
    });
  }
}
