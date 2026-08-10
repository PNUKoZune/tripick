import type { AddFriendRequestDto, FriendDto } from '@tripick/types';

import { api } from '@/shared/lib';

export function fetchFriends() {
  return api.get<FriendDto[]>('/friends');
}

export function addFriend(body: AddFriendRequestDto) {
  return api.post<FriendDto>('/friends', body);
}

export function acceptFriend(id: string) {
  return api.patch<FriendDto>(`/friends/${id}/accept`, {});
}

export function togglePinFriend(id: string) {
  return api.patch<FriendDto>(`/friends/${id}/pin`, {});
}

export function removeFriend(id: string) {
  return api.delete<void>(`/friends/${id}`);
}
