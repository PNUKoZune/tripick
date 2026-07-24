/// <reference types="jest" />

import { UsersService } from '../../src/users/users.service';
import type { UserEntity } from '../../src/users/user.entity';
import type { NotificationPreferencesDto } from '@tripick/types';

// prefersCategory 는 전달된 user 만 읽는 순수 판정이라, I/O 의존성은 주입하지 않고 캐스팅으로 만든다.
const service = new UsersService(
  null as any,
  null as any,
  null as any,
  null as any,
  null as any,
  null as any,
);

function user(prefs?: Partial<NotificationPreferencesDto>): UserEntity {
  return { notificationPreferences: prefs } as UserEntity;
}

describe('UsersService.prefersCategory 토글 분리', () => {
  it('설정이 없으면 모든 카테고리가 기본 수신(true)', () => {
    const u = user(undefined);
    for (const key of [
      'replan_ready',
      'weather_alert',
      'crowd_alert',
      'arrival_alert',
    ] as const) {
      expect(service.prefersCategory(u, key)).toBe(true);
    }
  });

  it('재계획(replan_ready)을 꺼도 날씨·혼잡·미도착 추천은 영향받지 않는다', () => {
    const u = user({ replan_ready: false });
    expect(service.prefersCategory(u, 'replan_ready')).toBe(false);
    expect(service.prefersCategory(u, 'weather_alert')).toBe(true);
    expect(service.prefersCategory(u, 'crowd_alert')).toBe(true);
    expect(service.prefersCategory(u, 'arrival_alert')).toBe(true);
  });

  it('날씨·혼잡·미도착 추천을 꺼도 재계획 알림은 유지된다', () => {
    const u = user({ weather_alert: false, crowd_alert: false, arrival_alert: false });
    expect(service.prefersCategory(u, 'weather_alert')).toBe(false);
    expect(service.prefersCategory(u, 'crowd_alert')).toBe(false);
    expect(service.prefersCategory(u, 'arrival_alert')).toBe(false);
    expect(service.prefersCategory(u, 'replan_ready')).toBe(true);
  });

  it('각 카테고리는 자기 키만 따른다(개별 제어)', () => {
    const u = user({ weather_alert: false });
    expect(service.prefersCategory(u, 'weather_alert')).toBe(false);
    // 함께 묶여 보이지만 저장은 독립 키 — crowd/arrival 은 자기 값(기본 true)을 따른다.
    expect(service.prefersCategory(u, 'crowd_alert')).toBe(true);
    expect(service.prefersCategory(u, 'arrival_alert')).toBe(true);
  });
});
