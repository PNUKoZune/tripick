'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlannerMemberDto } from '@tripick/types';

import { FriendAvatar, fetchFriends } from '@/entities/friend';
import { addTripMember, removeTripMember } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';
import { BottomSheet } from '@/shared/ui';

type Props = {
  open: boolean;
  onClose: () => void;
  tripId: string;
  tripTitle: string;
  members: PlannerMemberDto[];
};

function tripMemberIdFromFriend(friendId: string) {
  return `tm-${friendId}`;
}

export function TripMembersSheet({ open, onClose, tripId, tripTitle, members }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: friends = [] } = useQuery({
    queryKey: queryKeys.friends.list,
    queryFn: fetchFriends,
    staleTime: 60 * 1000,
    enabled: open,
  });

  const invalidateTrip = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.planner.trip(tripId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.planner.coordination(tripId) }),
    ]);
  };

  const addMutation = useMutation({
    mutationFn: (friendId: string) => addTripMember(tripId, { friendId }),
    onSuccess: invalidateTrip,
  });
  const removeMutation = useMutation({
    mutationFn: (memberId: string) => removeTripMember(tripId, memberId),
    onSuccess: invalidateTrip,
  });

  const errorMessage =
    addMutation.error instanceof Error
      ? addMutation.error.message
      : removeMutation.error instanceof Error
        ? removeMutation.error.message
        : null;

  const memberIdSet = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  const candidateFriends = useMemo(() => {
    const q = search.trim().toLowerCase();
    return friends
      .filter((f) => f.status === 'accepted')
      .filter((f) => !memberIdSet.has(tripMemberIdFromFriend(f.id)))
      .filter((f) =>
        q ? f.nickname.toLowerCase().includes(q) || f.handle.toLowerCase().includes(q) : true,
      );
  }, [friends, memberIdSet, search]);

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-5 pt-2">
        <div className="text-[12px] font-semibold text-[#3182F6]">{tripTitle}</div>
        <h2 className="mt-0.5 text-[20px] font-bold text-[#191F28]">여행 멤버</h2>
        <p className="mt-1 text-[13px] text-[#6B7684]">
          친구 목록에서 멤버를 추가하거나 제거할 수 있어요.
        </p>
      </div>

      <section className="mt-5 px-5">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-[#191F28]">현재 멤버</h3>
          <span className="text-[12px] font-semibold text-[#8B95A1]">{members.length}명</span>
        </div>
        <div className="mt-3 space-y-2">
          {members.length === 0 ? (
            <p className="rounded-[12px] bg-[#FAFBFC] px-3 py-3 text-center text-[13px] text-[#8B95A1]">
              아직 등록된 멤버가 없어요.
            </p>
          ) : (
            members.map((member) => {
              const isOwner = !member.id.startsWith('tm-');
              return (
                <div
                  key={member.id}
                  className="flex items-center gap-3 rounded-[12px] border border-[#E5E8EB] bg-white px-3 py-2.5"
                >
                  <FriendAvatar
                    friend={{ color: member.color, initial: member.initial }}
                    size="md"
                  />
                  <div className="flex-1 text-[14px] font-bold text-[#191F28]">
                    {member.initial}
                    {isOwner ? (
                      <span className="ml-2 rounded-full bg-[#F2F4F6] px-2 py-0.5 text-[11px] font-semibold text-[#6B7684]">
                        본 여행 기본 멤버
                      </span>
                    ) : null}
                  </div>
                  {!isOwner ? (
                    <button
                      type="button"
                      onClick={() => removeMutation.mutate(member.id)}
                      disabled={removeMutation.isPending}
                      className="h-9 rounded-[10px] border border-[#E5E8EB] px-3 text-[12px] font-bold text-[#6B7684] hover:bg-[#FAFBFC] disabled:opacity-50"
                    >
                      제외
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="mt-6 px-5 pb-6">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-[#191F28]">친구 목록에서 추가</h3>
          <span className="text-[12px] font-semibold text-[#8B95A1]">
            {candidateFriends.length}명
          </span>
        </div>
        <div className="mt-2 rounded-[14px] bg-[#F2F4F6] px-4 py-2.5">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="이름 또는 ID 검색"
            className="h-7 w-full bg-transparent text-[14px] font-semibold text-[#191F28] outline-none placeholder:text-[#8B95A1]"
          />
        </div>

        {errorMessage ? (
          <div className="mt-2 rounded-[12px] border border-[#FECDD3] bg-[#FFECEE] px-3 py-2 text-[12px] font-semibold text-[#F04452]">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-3 max-h-[260px] space-y-1 overflow-y-auto">
          {candidateFriends.length === 0 ? (
            <p className="rounded-[12px] bg-[#FAFBFC] px-3 py-3 text-center text-[13px] text-[#8B95A1]">
              추가할 수 있는 친구가 없어요.
            </p>
          ) : (
            candidateFriends.map((friend) => (
              <div
                key={friend.id}
                className="flex items-center gap-3 rounded-[12px] px-2 py-2 hover:bg-[#F7F8FA]"
              >
                <FriendAvatar friend={friend} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-bold text-[#191F28]">
                    {friend.nickname}
                  </div>
                  <div className="truncate text-[12px] text-[#8B95A1]">{friend.handle}</div>
                </div>
                <button
                  type="button"
                  onClick={() => addMutation.mutate(friend.id)}
                  disabled={addMutation.isPending}
                  className="h-9 rounded-[10px] bg-[#3182F6] px-3 text-[12px] font-bold text-white hover:bg-[#1B64DA] disabled:opacity-50"
                >
                  추가
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </BottomSheet>
  );
}
