/// <reference types="jest" />

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateScheduleChangeBodyDto } from '../../src/schedule-change/dto/schedule-change.dto';

/**
 * 제안 생성 DTO 검증. payload 는 kind 로 분기되는 discriminated union 이라
 * kind 에 맞는 하위 DTO 로 변환·검증돼야 한다.
 */
function build(obj: unknown) {
  return validate(plainToInstance(CreateScheduleChangeBodyDto, obj));
}

describe('CreateScheduleChangeBodyDto', () => {
  const tripId = '7ad4657d-cb04-4450-a6af-195e1ceb8791';
  const itemId = '1f8d1c2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

  it('add_item payload 를 통과시킨다', async () => {
    await expect(
      build({
        tripId,
        payload: { kind: 'add_item', body: { day: 2, name: '성산일출봉', scheduledAt: '10:00' } },
      }),
    ).resolves.toHaveLength(0);
  });

  it('swap payload 를 통과시킨다', async () => {
    await expect(
      build({
        tripId,
        payload: {
          kind: 'swap',
          body: { itemId, place: { name: '카페한라', lat: 33.4, lng: 126.5 } },
        },
      }),
    ).resolves.toHaveLength(0);
  });

  it('delete_item / replan payload 를 통과시킨다', async () => {
    await expect(
      build({ tripId, payload: { kind: 'delete_item', itemId } }),
    ).resolves.toHaveLength(0);
    await expect(
      build({ tripId, payload: { kind: 'replan', body: { trigger: 'manual', note: '조용한 곳' } } }),
    ).resolves.toHaveLength(0);
  });

  it('tripId 가 uuid 가 아니면 거절한다', async () => {
    const errors = await build({
      tripId: 'not-a-uuid',
      payload: { kind: 'add_item', body: { day: 1, name: 'x', scheduledAt: '10:00' } },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'tripId')).toBe(true);
  });

  it('add_item body 의 필수 필드(name·scheduledAt)가 없으면 거절한다', async () => {
    const errors = await build({
      tripId,
      payload: { kind: 'add_item', body: { day: 1 } },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('swap body 의 좌표가 없으면 거절한다', async () => {
    const errors = await build({
      tripId,
      payload: { kind: 'swap', body: { itemId, place: { name: '카페한라' } } },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('replan trigger 가 허용값이 아니면 거절한다', async () => {
    const errors = await build({
      tripId,
      payload: { kind: 'replan', body: { trigger: 'unknown' } },
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
