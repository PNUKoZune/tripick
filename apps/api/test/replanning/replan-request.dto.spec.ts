/// <reference types="jest" />

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AlternativeReplanRequestBodyDto,
  ReplanRequestBodyDto,
} from '../../src/replanning/dto/replan-request.dto';

describe('Replan request DTO validation', () => {
  it('accepts a valid waiting replan payload', async () => {
    const dto = plainToInstance(ReplanRequestBodyDto, {
      tripId: '7ad4657d-cb04-4450-a6af-195e1ceb8791',
      trigger: 'waiting',
      waitingMinutes: 35,
      currentLocation: { lat: 35.1532, lng: 129.1185 },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects invalid trigger, coordinates, and waiting minutes', async () => {
    const dto = plainToInstance(ReplanRequestBodyDto, {
      tripId: 'not-a-uuid',
      trigger: 'teleport',
      waitingMinutes: 999,
      currentLocation: { lat: 91, lng: 181 },
    });

    const errors = await validate(dto);
    const fields = errors.map((error) => error.property);

    expect(fields).toEqual(expect.arrayContaining(['tripId', 'trigger', 'waitingMinutes', 'currentLocation']));
    expect(errors.find((error) => error.property === 'currentLocation')?.children?.map((error) => error.property))
      .toEqual(expect.arrayContaining(['lat', 'lng']));
  });

  it('allows legacy alternative payloads that include trigger while endpoint overrides it', async () => {
    const dto = plainToInstance(AlternativeReplanRequestBodyDto, {
      tripId: '7ad4657d-cb04-4450-a6af-195e1ceb8791',
      trigger: 'manual',
      waitingMinutes: 20,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
