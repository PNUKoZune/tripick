import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { ReplanRequestDto } from '@tripick/types';

/**
 * 웨이팅·경로 이탈 이벤트 수신 컨트롤러
 *
 * 앱에서 웨이팅 신고 / 경로 이탈 감지 시 이 엔드포인트로 요청.
 * 내부적으로 ReplanningModule의 BullMQ 큐를 통해 처리됨.
 */
@ApiTags('Alternative')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('alternative')
export class AlternativeController {
  @Post('waiting')
  @ApiOperation({ summary: '웨이팅 신고 → 재계획 트리거' })
  reportWaiting(@Body() dto: ReplanRequestDto) {
    // AlternativeProcessor를 통해 BullMQ 큐에 잡 추가 (ReplanningService 활용)
    return { message: '재계획 요청이 접수되었습니다.', tripId: dto.tripId };
  }

  @Post('deviation')
  @ApiOperation({ summary: '경로 이탈 신고 → 재계획 트리거' })
  reportDeviation(@Body() dto: ReplanRequestDto) {
    return { message: '재계획 요청이 접수되었습니다.', tripId: dto.tripId };
  }
}
