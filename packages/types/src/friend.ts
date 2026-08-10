/**
 * 카카오톡 친구 목록 형태의 사용자 친구 관계 DTO.
 * 여행과 독립적으로 존재하며, 여행 멤버 추가 시 후보로 사용된다.
 */

export type FriendStatus = 'accepted' | 'pending' | 'incoming';

export interface FriendDto {
  id: string;
  nickname: string;
  /** 카카오 ID 또는 표시용 식별자 (예: "@koty") */
  handle: string;
  /** 아바타 배경색 (#hex) */
  color: string;
  /** 한 글자 이니셜 (UI 표시용) */
  initial: string;
  /** 선택 — 연결된 사용자의 프로필 사진 URL (있으면 아바타로 표시) */
  profileImageUrl?: string;
  /** 선택 — 이모지 프로필 사진 대체 */
  emoji?: string;
  /** 자기소개 한 줄 */
  statusMessage?: string;
  status: FriendStatus;
  /** 현재 사용자가 favorite 으로 핀한 친구 */
  pinned: boolean;
  createdAt: string;
}

export interface AddFriendRequestDto {
  /** 검색해서 추가할 카카오 핸들 (예: "koty") */
  handle: string;
}
