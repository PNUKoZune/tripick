/// <reference types="jest" />

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTripBodyDto, UpdateTripBodyDto } from '../../src/trips/dto/trip.dto';

/** 위반한 속성 이름 목록 */
async function violations(dto: object): Promise<string[]> {
  return (await validate(dto)).map((error) => error.property);
}

describe('CreateTripBodyDto', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(CreateTripBodyDto, {
      title: '부산 여행',
      destination: '부산',
      startDate: '2026-07-10',
      endDate: '2026-07-11',
      wakeTime: '08:00',
      sleepTime: '22:00',
      transportMode: 'transit',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('accepts a sleepTime that crosses midnight', async () => {
    const dto = plainToInstance(CreateTripBodyDto, {
      title: '부산 여행',
      destination: '부산',
      startDate: '2026-07-10',
      endDate: '2026-07-11',
      wakeTime: '08:00',
      sleepTime: '01:00',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects times that are not a real clock time', async () => {
    // \d{2}:\d{2} 만 보면 통과하는 값들이다.
    const dto = plainToInstance(CreateTripBodyDto, {
      title: '부산 여행',
      destination: '부산',
      startDate: '2026-07-10',
      endDate: '2026-07-11',
      wakeTime: '99:99',
      sleepTime: 'banana',
    });

    await expect(violations(dto)).resolves.toEqual(
      expect.arrayContaining(['wakeTime', 'sleepTime']),
    );
  });

  it('rejects a transportMode outside the canonical RouteMode union', async () => {
    // RouteHelper.getEta 의 switch 가 이 값을 만나면 던진다.
    const dto = plainToInstance(CreateTripBodyDto, {
      title: '부산 여행',
      destination: '부산',
      startDate: '2026-07-10',
      endDate: '2026-07-11',
      transportMode: 'teleport',
    });

    await expect(violations(dto)).resolves.toContain('transportMode');
  });

  it('rejects malformed dates and an empty title', async () => {
    const dto = plainToInstance(CreateTripBodyDto, {
      title: '',
      destination: '부산',
      startDate: '2026/07/10',
      endDate: '2026-13-45',
    });

    await expect(violations(dto)).resolves.toEqual(
      expect.arrayContaining(['title', 'startDate', 'endDate']),
    );
  });
});

describe('UpdateTripBodyDto', () => {
  it('accepts an empty patch', async () => {
    await expect(validate(plainToInstance(UpdateTripBodyDto, {}))).resolves.toHaveLength(0);
  });

  it('accepts null notes as a deletion', async () => {
    const dto = plainToInstance(UpdateTripBodyDto, { notes: null });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects an unknown status', async () => {
    const dto = plainToInstance(UpdateTripBodyDto, { status: 'teleporting' });
    await expect(violations(dto)).resolves.toContain('status');
  });
});
