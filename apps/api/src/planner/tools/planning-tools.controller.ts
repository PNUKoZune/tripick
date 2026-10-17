import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserEntity } from '../../users/user.entity';
import { perMinute } from '../../common/throttle';
import { PlanningToolsService } from './planning-tools.service';
import { PlanningContextDto, PlanningDraftDto, PlanningOptimizeDto } from './planning.dto';

@ApiTags('Planning tools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Throttle(perMinute(20))
@Controller('trips/:tripId/planning')
export class PlanningToolsController {
  constructor(private readonly tools: PlanningToolsService) {}

  @Post('context')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create an owned, versioned planning snapshot (draft only)' })
  context(
    @CurrentUser() user: UserEntity,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() body: PlanningContextDto,
  ) {
    return this.tools.getContext(user.id, tripId, body);
  }

  @Post('validate')
  @HttpCode(200)
  validate(
    @CurrentUser() user: UserEntity,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() body: PlanningDraftDto,
  ) {
    return this.tools.validate(user.id, tripId, body);
  }

  @Post('evaluate')
  @HttpCode(200)
  evaluate(
    @CurrentUser() user: UserEntity,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() body: PlanningDraftDto,
  ) {
    return this.tools.evaluate(user.id, tripId, body);
  }

  @Post('optimize')
  @HttpCode(200)
  @ApiOperation({ summary: 'Optimize unlocked same-day order within 50 evaluations / 2 seconds' })
  async optimize(
    @CurrentUser() user: UserEntity,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() body: PlanningOptimizeDto,
    @Req() request: Request,
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('Client disconnected'));
    const response = request.res;
    const closed = () => {
      if (!response?.writableEnded) abort();
    };
    request.once('aborted', abort);
    response?.once('close', closed);
    try {
      return await this.tools.optimize(user.id, tripId, body, controller.signal);
    } finally {
      request.removeListener('aborted', abort);
      response?.removeListener('close', closed);
    }
  }
}
