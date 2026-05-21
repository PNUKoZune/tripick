import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Body,
  HttpCode,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  CreateTripRequestDto,
  PlannerSwapRequestDto,
  PlannerSwapResponseDto,
} from '@tripick/types';
import {
  getPlannerAlternativesMock,
  getPlannerTripMock,
} from './main-planner.mock';
import { appendTripSummaryMock, TRIP_SUMMARIES_MOCK } from './main-planner-trips.mock';
import { searchDestinationsMock } from './destinations.mock';

/**
 * v1 Screen 3/4 mock controller.
 * 인증/DB 의존을 제거하고 고정 fixture 만 반환한다.
 */
@ApiTags('Main Planner (Mock v1)')
@Controller('main-planner')
export class MainPlannerController {
  @Get('trips')
  @ApiOperation({ summary: '내 여행 목록 mock' })
  listTrips() {
    return TRIP_SUMMARIES_MOCK;
  }

  @Get('destinations')
  @ApiOperation({ summary: '여행 지역 자동완성 mock' })
  searchDestinations(@Query('q') q?: string) {
    return searchDestinationsMock(q ?? '');
  }

  @Post('trips')
  @ApiOperation({ summary: '신규 여행 생성 mock (in-memory)' })
  createTrip(@Body() dto: CreateTripRequestDto) {
    if (!dto?.title?.trim()) {
      throw new BadRequestException('제목을 입력해주세요.');
    }
    if (!dto.destination?.trim()) {
      throw new BadRequestException('여행 지역을 입력해주세요.');
    }
    if (!dto.startDate || !dto.endDate) {
      throw new BadRequestException('여행 기간을 선택해주세요.');
    }
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException('시작일은 종료일보다 빨라야 합니다.');
    }
    if (!dto.startTime || !dto.endTime) {
      throw new BadRequestException('출발/도착 시각을 입력해주세요.');
    }
    if (dto.startDate === dto.endDate && dto.startTime >= dto.endTime) {
      throw new BadRequestException('도착 시각은 출발 시각보다 늦어야 합니다.');
    }
    return appendTripSummaryMock(dto);
  }

  @Get('trips/:tripId')
  @ApiOperation({ summary: 'Screen 3 메인 플래너 mock 데이터' })
  getTrip(@Param('tripId') tripId: string) {
    const trip = getPlannerTripMock(tripId);
    if (!trip) {
      throw new NotFoundException('mock trip not found');
    }
    return trip;
  }

  @Get('trips/:tripId/items/:itemId/alternatives')
  @ApiOperation({ summary: 'Screen 4 대안 추천 mock 데이터' })
  getAlternatives(
    @Param('tripId') tripId: string,
    @Param('itemId') itemId: string,
  ) {
    const trip = getPlannerTripMock(tripId);
    if (!trip) {
      throw new NotFoundException('mock trip not found');
    }
    const response = getPlannerAlternativesMock(itemId);
    if (!response) {
      throw new NotFoundException('mock alternatives not found');
    }
    return response;
  }

  @Post('trips/:tripId/swap')
  @HttpCode(200)
  @ApiOperation({ summary: 'Screen 4 대안 선택 → 일정 항목 치환 (mock)' })
  swap(
    @Param('tripId') tripId: string,
    @Body() dto: PlannerSwapRequestDto,
  ): PlannerSwapResponseDto {
    const trip = getPlannerTripMock(tripId);
    if (!trip) {
      throw new NotFoundException('mock trip not found');
    }
    const alternatives = getPlannerAlternativesMock(dto.itemId);
    const next = alternatives?.alternatives.find((alt) => alt.id === dto.alternativeId);
    if (!next) {
      throw new NotFoundException('alternative not found');
    }
    return {
      tripId,
      swappedItemId: dto.itemId,
      newItemName: next.name,
    };
  }
}
