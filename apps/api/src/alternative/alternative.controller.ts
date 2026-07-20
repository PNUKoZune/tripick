import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserEntity } from '../users/user.entity';
import { ReplanningService } from '../replanning/replanning.service';
import { AlternativeReplanRequestBodyDto } from '../replanning/dto/replan-request.dto';

@ApiTags('Alternative')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('alternative')
export class AlternativeController {
  constructor(private readonly replanningService: ReplanningService) {}

  @Post('deviation')
  @ApiOperation({ summary: '경로 이탈 신고 → 재계획 트리거' })
  reportDeviation(@CurrentUser() user: UserEntity, @Body() dto: AlternativeReplanRequestBodyDto) {
    return this.replanningService.enqueue(user.id, {
      ...dto,
      trigger: 'deviation',
    });
  }

  @Post('request')
  @ApiOperation({ summary: '대안 팝업 자유 텍스트 요청 → 재계획 트리거 (manual)' })
  requestReplan(@CurrentUser() user: UserEntity, @Body() dto: AlternativeReplanRequestBodyDto) {
    return this.replanningService.enqueue(user.id, {
      ...dto,
      trigger: 'manual',
    });
  }
}
