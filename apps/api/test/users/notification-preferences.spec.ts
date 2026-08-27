/// <reference types="jest" />

import { UsersService } from '../../src/users/users.service';
import type { UserEntity } from '../../src/users/user.entity';
import { UpdateNotificationPreferencesBodyDto } from '../../src/users/dto/update-notification-preferences.dto';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

function harness(stored?: Record<string, unknown>) {
  const user = { id: 'u1', notificationPreferences: stored } as unknown as UserEntity;
  const repo = {
    findOneBy: jest.fn().mockResolvedValue(user),
    save: jest.fn(async (v: unknown) => v),
  };
  const service = new UsersService(
    repo as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
  return { service, user };
}

function validate(body: unknown): string[] {
  const dto = plainToInstance(UpdateNotificationPreferencesBodyDto, body);
  return validateSync(dto).flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('알림 설정 DTO 검증', () => {
  it('알려진 키 + boolean 은 통과', () => {
    expect(validate({ preferences: { weather_alert: false, replan_ready: true } })).toEqual([]);
  });

  it('빈 객체(변경 없음)도 통과', () => {
    expect(validate({ preferences: {} })).toEqual([]);
  });

  // 예전엔 공유 타입이 인터페이스라 ValidationPipe 가 안 걸려 아무 키나 jsonb 에 들어갔다.
  it('모르는 키는 거부', () => {
    expect(validate({ preferences: { hacked: true } })).not.toEqual([]);
  });

  it('boolean 이 아닌 값은 거부', () => {
    expect(validate({ preferences: { weather_alert: 'nope' } })).not.toEqual([]);
  });

  it('객체가 아니면 거부', () => {
    expect(validate({ preferences: ['weather_alert'] })).not.toEqual([]);
    expect(validate({ preferences: null })).not.toEqual([]);
  });
});

describe('UsersService.updateNotificationPreferences 저장 시 좁히기', () => {
  it('알려진 키만 저장한다', async () => {
    const { service } = harness();
    const saved = await service.updateNotificationPreferences('u1', {
      weather_alert: false,
      hacked: 'payload',
    } as never);

    expect(saved.weather_alert).toBe(false);
    expect(saved).not.toHaveProperty('hacked');
  });

  /** 과거에 들어간 쓰레기가 계속 실려 다니지 않도록 읽을 때도 좁힌다. */
  it('이미 저장돼 있던 모르는 키도 걷어낸다', async () => {
    const { service } = harness({ junk: 1, crowd_alert: false });
    const saved = await service.updateNotificationPreferences('u1', { replan_ready: false });

    expect(saved).not.toHaveProperty('junk');
    expect(saved.crowd_alert).toBe(false); // 기존 유효 설정은 유지
    expect(saved.replan_ready).toBe(false);
  });
});
