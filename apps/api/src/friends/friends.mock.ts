import type { FriendDto } from '@tripick/types';

/**
 * 카카오톡 친구 목록 톤의 v1 mock 데이터.
 * 인증 없이 단일 사용자의 전역 친구 목록을 시뮬레이션한다.
 * 프로세스 재시작 시 초기화된다.
 */
export const FRIENDS_MOCK: FriendDto[] = [
  {
    id: 'friend-koty',
    nickname: '코티',
    handle: '@koty',
    color: '#3182F6',
    initial: '코',
    emoji: '🧳',
    statusMessage: '여행은 동기부여 1순위',
    status: 'accepted',
    pinned: true,
    createdAt: '2025-02-01T09:00:00.000Z',
  },
  {
    id: 'friend-taeyang',
    nickname: '태양',
    handle: '@taeyang',
    color: '#FF8A00',
    initial: '태',
    emoji: '🌅',
    statusMessage: '바다 보러 가요',
    status: 'accepted',
    pinned: true,
    createdAt: '2025-02-02T09:00:00.000Z',
  },
  {
    id: 'friend-bak',
    nickname: '박지호',
    handle: '@jiho.bak',
    color: '#6B7684',
    initial: '박',
    statusMessage: '맛집 큐레이터',
    status: 'accepted',
    pinned: false,
    createdAt: '2025-03-10T09:00:00.000Z',
  },
  {
    id: 'friend-hong',
    nickname: '홍수민',
    handle: '@hong.sm',
    color: '#191F28',
    initial: '홍',
    emoji: '📷',
    statusMessage: '사진 찍는 거 좋아함',
    status: 'accepted',
    pinned: false,
    createdAt: '2025-03-15T09:00:00.000Z',
  },
  {
    id: 'friend-min',
    nickname: '민지',
    handle: '@minji',
    color: '#00A86B',
    initial: '민',
    emoji: '🍰',
    statusMessage: '디저트 투어 ✦',
    status: 'accepted',
    pinned: false,
    createdAt: '2025-04-02T09:00:00.000Z',
  },
  {
    id: 'friend-cha',
    nickname: '차은우',
    handle: '@chaewoo',
    color: '#7C3AED',
    initial: '차',
    statusMessage: '주말 캠퍼',
    status: 'accepted',
    pinned: false,
    createdAt: '2025-04-20T09:00:00.000Z',
  },
  {
    id: 'friend-pending-yoon',
    nickname: '윤서아',
    handle: '@yoon.sa',
    color: '#8B95A1',
    initial: '윤',
    statusMessage: '여행 메이트 구해요',
    status: 'incoming',
    pinned: false,
    createdAt: '2025-05-18T09:00:00.000Z',
  },
];

function colorFromString(value: string) {
  const palette = ['#3182F6', '#00A86B', '#FF8A00', '#6B7684', '#191F28', '#7C3AED', '#F04452'];
  let sum = 0;
  for (const ch of value) sum = (sum + ch.charCodeAt(0)) % 997;
  return palette[sum % palette.length] ?? '#3182F6';
}

export function addFriendMock(handleInput: string): FriendDto {
  const handle = handleInput.startsWith('@') ? handleInput : `@${handleInput}`;
  const nickname = handle.replace(/^@/, '');
  const initial = nickname.slice(0, 1).toUpperCase();
  const friend: FriendDto = {
    id: `friend-${Date.now().toString(36)}`,
    nickname,
    handle,
    color: colorFromString(handle),
    initial,
    status: 'pending',
    pinned: false,
    createdAt: new Date().toISOString(),
  };
  FRIENDS_MOCK.push(friend);
  return friend;
}

export function acceptFriendMock(id: string): FriendDto | undefined {
  const friend = FRIENDS_MOCK.find((f) => f.id === id);
  if (!friend) return undefined;
  friend.status = 'accepted';
  return friend;
}

export function togglePinFriendMock(id: string): FriendDto | undefined {
  const friend = FRIENDS_MOCK.find((f) => f.id === id);
  if (!friend) return undefined;
  friend.pinned = !friend.pinned;
  return friend;
}

export function removeFriendMock(id: string): boolean {
  const index = FRIENDS_MOCK.findIndex((f) => f.id === id);
  if (index === -1) return false;
  FRIENDS_MOCK.splice(index, 1);
  return true;
}

export function getFriendByIdMock(id: string): FriendDto | undefined {
  return FRIENDS_MOCK.find((f) => f.id === id);
}
