import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
  requestReplan(@Body() dto: ReplanRequestDto) {
    return this.replanningService.enqueue(dto);
  }
}
