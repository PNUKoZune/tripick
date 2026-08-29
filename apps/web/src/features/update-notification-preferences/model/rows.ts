import { DEFAULT_NOTIFICATION_PREFERENCES } from '@tripick/types';
import type { NotificationPreferenceKey } from '@tripick/types';

export type Preferences = Partial<Record<NotificationPreferenceKey, boolean>>;

/**
 * key: 스위치 상태를 읽는 대표 키. alsoKeys 가 있으면 토글 시 함께 갱신한다.
 * 성격이 같은 카테고리는 한 줄로 묶는다 — 사용자는 "날씨 때문에 온 알림"과 "혼잡 때문에 온 알림"을
 * 따로 관리하지 않고, 일정 변경 제안도 요청(owner)·결과(참여자)가 같은 기능의 양쪽 끝이라
 * 한쪽만 남으면 오히려 이상하다.
 */
export const ROWS: ReadonlyArray<{
  key: NotificationPreferenceKey;
  alsoKeys?: ReadonlyArray<NotificationPreferenceKey>;
  label: string;
  description: string;
}> = [
  {
    key: 'trip_invite',
    label: '여행 초대',
    description: '친구가 여행에 초대했을 때 알려줘요.',
  },
  {
    key: 'friend_request',
    label: '친구 요청',
    description: '새로운 친구 요청이 도착했을 때 알려줘요.',
  },
  {
    key: 'replan_ready',
    label: '재계획 완료',
    description: '요청한 대안 일정 반영이 끝나면 알려줘요.',
  },
  {
    key: 'weather_alert',
    alsoKeys: ['crowd_alert', 'arrival_alert'],
    label: '날씨·혼잡·미도착 추천',
    description: '날씨·혼잡·미도착 등 상황이 바뀌면 일정을 바꿀지 추천해요.',
  },
  {
    key: 'schedule_change_request',
    alsoKeys: ['schedule_change_result'],
    label: '일정 변경 요청·결과',
    description: '동행이 일정 변경을 제안하거나, 내 제안이 처리되면 알려줘요.',
  },
  {
    key: 'trip_reminder',
    label: '여행 임박 리마인더',
    description: '출발 하루 전에 챙길 것을 정리해 알려줘요.',
  },
  {
    key: 'general',
    label: '일반 알림',
    description: '서비스 안내나 이벤트 소식을 알려줘요.',
  },
];

export const ALL_KEYS = Object.keys(
  DEFAULT_NOTIFICATION_PREFERENCES,
) as NotificationPreferenceKey[];
