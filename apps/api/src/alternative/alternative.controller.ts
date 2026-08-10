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
  @ApiOperation({ summary: '사용자 재계획 요청 → 재계획 트리거 (기본 manual)' })
  requestReplan(@CurrentUser() user: UserEntity, @Body() dto: AlternativeReplanRequestBodyDto) {
    return this.replanningService.enqueue(user.id, {
      ...dto,
      // 요청에 실린 트리거를 그대로 쓰고, 없을 때만 manual 로 떨어뜨린다.
      // 무조건 manual 로 덮어쓰면 알림 배너(날씨·혼잡·미도착)에서 연 재계획이
      // 검색 키워드("실내 관광"·"한적한 관광지")·CRAG context 점수·LLM 프롬프트에서
      // 전부 일반 재계획으로 취급돼, 알림→재계획 배선이 조용히 무효가 된다.
      trigger: dto.trigger ?? 'manual',
    });
  }
}
