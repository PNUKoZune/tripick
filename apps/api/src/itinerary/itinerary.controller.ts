import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ItineraryService } from './itinerary.service';

@ApiTags('Itinerary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trips/:tripId/itinerary')
export class ItineraryController {
  constructor(private readonly itineraryService: ItineraryService) {}

  @Get()
  @ApiOperation({ summary: '여행 일정 아이템 전체 조회' })
  findAll(@Param('tripId') tripId: string) {
    return this.itineraryService.findByTrip(tripId);
  }
}
