'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PlannerMemberDto } from '@tripick/types';

import { FriendAvatar, fetchFriends } from '@/entities/friend';
import { queryKeys } from '@/shared/api/query-keys';

type Props = {
  members: PlannerMemberDto[];
  onAdd: (member: PlannerMemberDto) => void;
  onRemove: (memberId: string) => void;
};

export function friendIdToMemberId(friendId: string) {
  return `f-${friendId}`;
}

const DROPDOWN_GAP = 8;
const MIN_DROPDOWN_HEIGHT = 220;
const VIEWPORT_MARGIN = 16;

export function FriendMemberPicker({ members, onAdd, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<'down' | 'up'>('down');
  const [maxHeight, setMaxHeight] = useState(320);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const { data: friends = [], isPending, error } = useQuery({
    queryKey: queryKeys.friends.list,
    queryFn: fetchFriends,
    staleTime: 60 * 1000,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function measure() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportH = window.innerHeight;
      const spaceBelow = viewportH - rect.bottom - DROPDOWN_GAP - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - DROPDOWN_GAP - VIEWPORT_MARGIN;
      if (spaceBelow >= MIN_DROPDOWN_HEIGHT || spaceBelow >= spaceAbove) {
        setDirection('down');
        setMaxHeight(Math.max(MIN_DROPDOWN_HEIGHT, Math.min(360, spaceBelow)));
      } else {
        setDirection('up');
        setMaxHeight(Math.max(MIN_DROPDOWN_HEIGHT, Math.min(360, spaceAbove)));
      }
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  const selectedIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return friends
      .filter((f) => f.status === 'accepted')
      .filter((f) =>
        q ? f.nickname.toLowerCase().includes(q) || f.handle.toLowerCase().includes(q) : true,
      );
  }, [friends, search]);

  const errorMessage = error instanceof Error ? error.message : null;

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex flex-wrap items-center gap-2">
        {members.map((member) => {
          const isSelf = member.id === 'me';
          return (
            <span
              key={member.id}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#F2F4F6] pl-2 pr-1 text-[13px] font-semibold text-[#191F28]"
            >
              <FriendAvatar
                friend={{ color: member.color, initial: member.initial }}
                size="sm"
              />
              <span>{member.initial}</span>
              {!isSelf ? (
                <button
                  type="button"
                  onClick={() => onRemove(member.id)}
                  aria-label={`${member.initial} 제거`}
                  className="ml-0.5 flex size-6 items-center justify-center rounded-full text-[#8B95A1] hover:bg-[#E5E8EB] hover:text-[#191F28]"
                >
                  ×
                </button>
              ) : null}
            </span>
          );
        })}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition ${
            open
              ? 'border-[#3182F6] bg-[#EAF2FF] text-[#1B64DA]'
              : 'border-dashed border-[#D6DBE1] bg-white text-[#6B7684] hover:bg-[#FAFBFC]'
          }`}
        >
          <span aria-hidden>＋</span>
          <span>친구 추가</span>
        </button>
      </div>

      {open ? (
        <div
          className={`absolute left-0 right-0 z-30 flex flex-col overflow-hidden rounded-[14px] border border-[#E5E8EB] bg-white shadow-[0_12px_28px_rgba(0,0,0,0.08)] ${
            direction === 'down' ? 'top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)]'
          }`}
          style={{ maxHeight }}
        >
          <div className="border-b border-[#E5E8EB] bg-[#F7F8FA] px-3 py-2">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="이름 또는 ID 검색"
              autoFocus
              className="h-8 w-full bg-transparent text-[13px] font-semibold text-[#191F28] outline-none placeholder:text-[#8B95A1]"
            />
          </div>

          {errorMessage ? (
            <div className="px-3 py-3 text-[12px] font-semibold text-[#F04452]">
              {errorMessage}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isPending ? (
              <div className="px-3 py-4 text-center text-[12px] text-[#8B95A1]">
                친구 목록 불러오는 중…
              </div>
            ) : candidates.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-[#8B95A1]">
                추가할 수 있는 친구가 없어요.
                <div className="mt-1 text-[11px]">
                  먼저 친구 페이지에서 친구를 등록해주세요.
                </div>
              </div>
            ) : (
              candidates.map((friend) => {
                const memberId = friendIdToMemberId(friend.id);
                const selected = selectedIds.has(memberId);
                return (
                  <button
                    key={friend.id}
                    type="button"
                    onClick={() => {
                      if (selected) {
                        onRemove(memberId);
                      } else {
                        onAdd({
                          id: memberId,
                          initial: friend.initial,
                          color: friend.color,
                        });
                      }
                    }}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${
                      selected ? 'bg-[#EAF2FF]' : 'hover:bg-[#F7F8FA]'
                    }`}
                  >
                    <FriendAvatar friend={friend} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-bold text-[#191F28]">
                        {friend.nickname}
                      </div>
                      <div className="truncate text-[12px] text-[#8B95A1]">{friend.handle}</div>
                    </div>
                    <span
                      className={`flex size-6 items-center justify-center rounded-full border text-[12px] ${
                        selected
                          ? 'border-[#3182F6] bg-[#3182F6] text-white'
                          : 'border-[#D6DBE1] text-transparent'
                      }`}
                      aria-hidden
                    >
                      ✓
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
