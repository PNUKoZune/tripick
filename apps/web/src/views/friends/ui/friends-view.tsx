'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FriendDto } from '@tripick/types';

import {
  acceptFriend,
  addFriend,
  FriendRow,
  fetchFriends,
  removeFriend,
  togglePinFriend,
} from '@/entities/friend';
import { SessionGuard } from '@/entities/session';
import { queryKeys } from '@/shared/api/query-keys';
import { AppFrame, PageContainer, PageHeader } from '@/shared/ui/app-frame';

export function FriendsView() {
  return (
    <SessionGuard>
      <FriendsContent />
    </SessionGuard>
  );
}

function FriendsContent() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [addInput, setAddInput] = useState('');

  const { data: friends = [], error } = useQuery({
    queryKey: queryKeys.friends.list,
    queryFn: fetchFriends,
    staleTime: 60 * 1000,
  });

  const loadError = error instanceof Error ? error.message : null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.friends.list });

  const addMutation = useMutation({ mutationFn: addFriend, onSuccess: () => invalidate() });
  const acceptMutation = useMutation({ mutationFn: acceptFriend, onSuccess: () => invalidate() });
  const pinMutation = useMutation({ mutationFn: togglePinFriend, onSuccess: () => invalidate() });
  const removeMutation = useMutation({ mutationFn: removeFriend, onSuccess: () => invalidate() });

  const mutationError = addMutation.error instanceof Error ? addMutation.error.message : null;

  const { pinned, others, incoming } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? friends.filter(
          (f) => f.nickname.toLowerCase().includes(q) || f.handle.toLowerCase().includes(q),
        )
      : friends;
    return {
      pinned: filtered.filter((f) => f.status === 'accepted' && f.pinned),
      others: filtered.filter((f) => f.status === 'accepted' && !f.pinned),
      incoming: filtered.filter((f) => f.status === 'incoming'),
    };
  }, [friends, search]);

  function handleAdd() {
    const handle = addInput.trim();
    if (!handle) return;
    addMutation.mutate({ handle }, { onSuccess: () => setAddInput('') });
  }

  const content = (
    <div className="space-y-4">
      <div className="rounded-[14px] bg-[#F2F4F6] px-4 py-2.5">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="이름 또는 ID 검색"
          className="h-7 w-full bg-transparent text-[14px] font-semibold text-[#191F28] outline-none placeholder:text-[#8B95A1]"
        />
      </div>

      <div className="rounded-[16px] border border-[#E5E8EB] bg-white p-3">
        <div className="flex items-center gap-2">
          <span className="text-[20px]" aria-hidden>
            ＋
          </span>
          <span className="text-[13px] font-bold text-[#191F28]">친구 추가</span>
        </div>
        <p className="mt-1 text-[12px] text-[#8B95A1]">
          카카오 ID 또는 핸들을 입력하면 친구 목록에 저장합니다.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={addInput}
            onChange={(event) => setAddInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAdd();
              }
            }}
            placeholder="예) koty 또는 @koty"
            className="h-11 flex-1 rounded-[12px] border border-[#E5E8EB] bg-white px-3 text-[14px] font-medium text-[#191F28] outline-none placeholder:text-[#B0B8C1] focus:border-[#3182F6]"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!addInput.trim() || addMutation.isPending}
            className="h-11 rounded-[12px] bg-[#3182F6] px-4 text-[13px] font-bold text-white transition hover:bg-[#1B64DA] disabled:bg-[#E5E8EB] disabled:text-[#B0B8C1]"
          >
            요청
          </button>
        </div>
        {mutationError ? (
          <p className="mt-2 text-[12px] font-semibold text-[#F04452]">{mutationError}</p>
        ) : null}
      </div>

      {loadError ? (
        <div className="rounded-[16px] border border-[#FECDD3] bg-[#FFECEE] p-4 text-[14px] text-[#F04452]">
          {loadError}
        </div>
      ) : null}

      {incoming.length > 0 ? (
        <FriendSection title="받은 요청" count={incoming.length}>
          {incoming.map((friend) => (
            <FriendRow
              key={friend.id}
              friend={friend}
              trailing={
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => acceptMutation.mutate(friend.id)}
                    className="h-9 rounded-[10px] bg-[#3182F6] px-3 text-[12px] font-bold text-white hover:bg-[#1B64DA]"
                  >
                    수락
                  </button>
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(friend.id)}
                    aria-label={`${friend.nickname} 요청 거절`}
                    className="h-9 rounded-[10px] border border-[#E5E8EB] px-3 text-[12px] font-bold text-[#6B7684] hover:bg-[#FAFBFC]"
                  >
                    거절
                  </button>
                </div>
              }
            />
          ))}
        </FriendSection>
      ) : null}

      {pinned.length > 0 ? (
        <FriendSection title="즐겨찾기" count={pinned.length}>
          {pinned.map((friend) => (
            <FriendRow
              key={friend.id}
              friend={friend}
              trailing={
                <FriendRowMenu
                  friend={friend}
                  onPin={pinMutation.mutate}
                  onRemove={removeMutation.mutate}
                />
              }
            />
          ))}
        </FriendSection>
      ) : null}

      <FriendSection title="친구" count={others.length}>
        {others.length === 0 && !loadError ? (
          <p className="px-4 py-6 text-center text-[13px] text-[#8B95A1]">
            친구가 없어요. 카카오 ID로 친구를 추가해보세요.
          </p>
        ) : (
          others.map((friend) => (
            <FriendRow
              key={friend.id}
              friend={friend}
              trailing={
                <FriendRowMenu
                  friend={friend}
                  onPin={pinMutation.mutate}
                  onRemove={removeMutation.mutate}
                />
              }
            />
          ))
        )}
      </FriendSection>
    </div>
  );

  return (
    <AppFrame>
      <PageHeader
        title="친구"
        label="친구"
        description="카카오톡 친구 추가하듯, 핸들로 친구를 추가하고 여행 멤버 후보로 둡니다."
        action={
          friends.length > 0 ? (
            <span className="text-[13px] font-semibold text-[#6B7684]">
              전체 {friends.length}명
            </span>
          ) : null
        }
      />
      <PageContainer>{content}</PageContainer>
    </AppFrame>
  );
}

function FriendSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[16px] border border-[#E5E8EB] bg-white">
      <div className="flex items-center justify-between border-b border-[#E5E8EB] bg-[#FAFBFC] px-4 py-2.5">
        <h2 className="text-[13px] font-bold text-[#191F28]">{title}</h2>
        <span className="text-[12px] font-semibold text-[#8B95A1]">{count}</span>
      </div>
      <div className="divide-y divide-[#F2F4F6]">{children}</div>
    </section>
  );
}

function FriendRowMenu({
  friend,
  onPin,
  onRemove,
}: {
  friend: FriendDto;
  onPin: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onPin(friend.id)}
        aria-label={friend.pinned ? '즐겨찾기 해제' : '즐겨찾기'}
        className={`flex size-9 items-center justify-center rounded-[10px] text-[16px] transition ${
          friend.pinned
            ? 'text-[#FF8A00]'
            : 'text-[#B0B8C1] hover:bg-[#F7F8FA] hover:text-[#FF8A00]'
        }`}
      >
        {friend.pinned ? '★' : '☆'}
      </button>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`${friend.nickname}을(를) 친구 목록에서 삭제할까요?`)) {
            onRemove(friend.id);
          }
        }}
        aria-label={`${friend.nickname} 삭제`}
        className="flex size-9 items-center justify-center rounded-[10px] text-[#B0B8C1] transition hover:bg-[#FFECEE] hover:text-[#F04452]"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M3 3l8 8M11 3l-8 8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
