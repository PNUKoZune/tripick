/// <reference types="jest" />

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateTripRequestBodyDto,
  PlannerSwapRequestBodyDto,
} from '../../src/main-planner/dto/main-planner.dto';

describe('Main planner DTO validation', () => {
  it('accepts a valid trip creation payload', async () => {
    const dto = plainToInstance(CreateTripRequestBodyDto, {
      title: '부산 카페 여행',
      destination: '부산',
      startDate: '2026-07-10',
      startTime: '09:00',
      endDate: '2026-07-10',
      endTime: '21:00',
      members: [
        {
          id: 'tm-7ad4657d-cb04-4450-a6af-195e1ceb8791',
          friendId: '7ad4657d-cb04-4450-a6af-195e1ceb8791',
          initial: 'J',
          color: '#3182F6',
          role: 'companion',
        },
      ],
      notes: '웨이팅 적고 걷기 적은 코스',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects malformed dates, times, and nested member payloads', async () => {
    const dto = plainToInstance(CreateTripRequestBodyDto, {
      title: '',
      destination: '',
      startDate: '2026/07/10',
      startTime: '9am',
      endDate: 'bad-date',
      endTime: 'late',
      members: [{ id: '', initial: '', color: '' }],
    });

    const errors = await validate(dto);
    const fields = errors.map((error) => error.property);

    expect(fields).toEqual(
      expect.arrayContaining(['title', 'destination', 'startDate', 'startTime', 'endDate', 'endTime', 'members']),
    );
    expect(errors.find((error) => error.property === 'members')?.children?.[0]?.children?.map((error) => error.property))
      .toEqual(expect.arrayContaining(['id', 'initial', 'color']));
  });

  it('requires a UUID itinerary item id for swaps', async () => {
    const dto = plainToInstance(PlannerSwapRequestBodyDto, {
      itemId: 'not-a-uuid',
      alternativeId: 'alt-1',
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toContain('itemId');
  });
});
