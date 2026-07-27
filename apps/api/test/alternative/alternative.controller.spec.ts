/// <reference types="jest" />

import { AlternativeController } from '../../src/alternative/alternative.controller';
import type { UserEntity } from '../../src/users/user.entity';

describe('AlternativeController', () => {
  const replanning = { enqueue: jest.fn() };
  const controller = new AlternativeController(replanning as any);
  const user = { id: 'user-1' } as UserEntity;
  const tripId = '7ad4657d-cb04-4450-a6af-195e1ceb8791';

  beforeEach(() => jest.clearAllMocks());

  it('keeps the trigger sent with a replan request', async () => {
    // 알림 배너(날씨·혼잡·미도착)에서 연 재계획은 그 트리거로 검색 키워드·CRAG 점수·
    // 프롬프트가 조향된다. manual 로 덮으면 알림→재계획 배선이 통째로 무효가 된다.
    await controller.requestReplan(user, { tripId, trigger: 'weather' });

    expect(replanning.enqueue).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ tripId, trigger: 'weather' }),
    );
  });

  it('falls back to manual when the request carries no trigger', async () => {
    await controller.requestReplan(user, { tripId });

    expect(replanning.enqueue).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ trigger: 'manual' }),
    );
  });

  it('forces the deviation trigger on the deviation report endpoint', async () => {
    // 이탈 신고 전용 경로라 바디의 트리거를 신뢰하지 않는다.
    await controller.reportDeviation(user, { tripId, trigger: 'manual' });

    expect(replanning.enqueue).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ trigger: 'deviation' }),
    );
  });
});
