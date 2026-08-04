/// <reference types="jest" />

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePreferenceBodyDto } from '../../src/preferences/dto/preference.dto';

/** 위반한 속성 이름 목록 (중첩 객체는 부모 속성명으로 잡힌다) */
async function violations(dto: object): Promise<string[]> {
  return (await validate(dto)).map((error) => error.property);
}

describe('UpdatePreferenceBodyDto', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(UpdatePreferenceBodyDto, {
      tasteTags: { food: ['korean', 'cafe'], mood: ['healing'], confidence: 0.8 },
      profile: {
        wakeTime: '07:30',
        sleepTime: '23:00',
        likedThemes: ['cafe_dessert'],
        pace: 'balanced',
      },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('accepts a night owl sleepTime that crosses midnight', async () => {
    const dto = plainToInstance(UpdatePreferenceBodyDto, {
      tasteTags: {},
      profile: { wakeTime: '08:00', sleepTime: '01:00' },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a profile time that is not a real clock time', async () => {
    // 이 값이 저장되면 여행 생성 시점에 알 수 없는 400 으로 되돌아온다.
    const dto = plainToInstance(UpdatePreferenceBodyDto, {
      tasteTags: {},
      profile: { sleepTime: 'banana', wakeTime: '25:00' },
    });

    await expect(violations(dto)).resolves.toContain('profile');
  });

  it('rejects an operator object smuggled in place of a time string', async () => {
    const dto = plainToInstance(UpdatePreferenceBodyDto, {
      tasteTags: {},
      profile: { sleepTime: { $ne: null } },
    });

    await expect(violations(dto)).resolves.toContain('profile');
  });

  it('rejects taste tags outside the known unions', async () => {
    const dto = plainToInstance(UpdatePreferenceBodyDto, {
      tasteTags: { food: ['korean', 'martian'], mood: ['unknown-mood'] },
    });

    await expect(violations(dto)).resolves.toContain('tasteTags');
  });

  it('rejects a confidence outside 0~1', async () => {
    const dto = plainToInstance(UpdatePreferenceBodyDto, { tasteTags: { confidence: 42 } });
    await expect(violations(dto)).resolves.toContain('tasteTags');
  });

  it('rejects an unknown theme', async () => {
    const dto = plainToInstance(UpdatePreferenceBodyDto, {
      tasteTags: {},
      profile: { likedThemes: ['spelunking'] },
    });

    await expect(violations(dto)).resolves.toContain('profile');
  });
});
