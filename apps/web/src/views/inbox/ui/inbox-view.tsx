'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InboxItemDto, InboxItemKind, NotificationCategory } from '@tripick/types';

import { acceptFriend, removeFriend } from '@/entities/friend';
import { fetchInbox, markAllInboxRead, markInboxRead } from '@/entities/inbox';
import { SessionGuard } from '@/entities/session';
import { acceptTripInvite, rejectTripInvite } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';
import { AppFrame, PageContainer, PageHeader } from '@/shared/ui/app-frame';

type Filter = 'all' | 'unread' | 'action';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'unread', label: '읽지 않음' },
  { value: 'action', label: '응답 필요' },
];

const KIND_META: Record<InboxItemKind, { emoji: string; label: string; tone: string }> = {
  friend_request: { emoji: '👋', label: '친구 요청', tone: '#3182F6' },
  trip_invite: { emoji: '🎟️', label: '여행 초대', tone: '#7C3AED' },
  replan_ready: { emoji: '✨', label: '재계획 알림', tone: '#00A86B' },
  weather_alert: { emoji: '☔', label: '날씨 알림', tone: '#FF8A00' },
  crowd_alert: { emoji: '👥', label: '혼잡 알림', tone: '#E0529C' },
  trip_reminder: { emoji: '🧳', label: '여행 알림', tone: '#1B64DA' },
  general: { emoji: '📬', label: '알림', tone: '#6B7684' },
};

const CATEGORY_KINDS: Set<InboxItemKind> = new Set([
  'replan_ready',
  'weather_alert',
  'crowd_alert',
  'trip_reminder',
  'general',
]);

export function InboxView() {
  return (
    <SessionGuard>
      <InboxContent />
    </SessionGuard>
  );
}

function InboxContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');

  const { data, error } = useQuery({
    queryKey: queryKeys.inbox.list,
    queryFn: fetchInbox,
    staleTime: 30 * 1000,
  });
  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const loadError = error instanceof Error ? error.message : null;

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox.list }),
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.list }),
    ]);

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox.list }),
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.list }),
      queryClient.invalidateQueries({ queryKey: queryKeys.planner.trips }),
    ]);

  const readMutation = useMutation({ mutationFn: markInboxRead, onSuccess: () => invalidate() });
  const readAllMutation = useMutation({
    mutationFn: markAllInboxRead,
    onSuccess: () => invalidate(),
  });
  const acceptMutation = useMutation({ mutationFn: acceptFriend, onSuccess: () => invalidate() });
  const rejectMutation = useMutation({ mutationFn: removeFriend, onSuccess: () => invalidate() });
  const acceptInviteMutation = useMutation({
    mutationFn: ({ tripId, tripMemberId }: { tripId: string; tripMemberId: string }) =>
      acceptTripInvite(tripId, tripMemberId),
    onSuccess: (_data, variables) =>
      Promise.all([
        invalidateAll(),
        queryClient.invalidateQueries({
          queryKey: queryKeys.planner.trip(variables.tripId),
        }),
      ]),
  });
  const rejectInviteMutation = useMutation({
    mutationFn: ({ tripId, tripMemberId }: { tripId: string; tripMemberId: string }) =>
      rejectTripInvite(tripId, tripMemberId),
    onSuccess: () => invalidateAll(),
  });

  const filteredItems = useMemo(() => {
    if (filter === 'unread') return items.filter((item) => !item.readAt);
    if (filter === 'action') return items.filter((item) => item.actions.length > 0);
    return items;
  }, [items, filter]);

  const grouped = useMemo(() => groupByDate(filteredItems), [filteredItems]);

  function handleAction(item: InboxItemDto, actionType: string) {
    const action = item.actions.find((a) => a.type === actionType);
    if (!action) return;
    if (action.type === 'accept-friend' && action.friendId) {
      acceptMutation.mutate(action.friendId);
    } else if (action.type === 'reject-friend' && action.friendId) {
      rejectMutation.mutate(action.friendId);
    } else if (action.type === 'accept-trip-invite' && action.tripId && action.tripMemberId) {
      if (!item.readAt) readMutation.mutate(item.id);
      acceptInviteMutation.mutate(
        { tripId: action.tripId, tripMemberId: action.tripMemberId },
        {
          onSuccess: () => {
            router.push(`/planner?tripId=${action.tripId}`);
          },
        },
      );
    } else if (action.type === 'reject-trip-invite' && action.tripId && action.tripMemberId) {
      if (!item.readAt) readMutation.mutate(item.id);
      rejectInviteMutation.mutate({
        tripId: action.tripId,
        tripMemberId: action.tripMemberId,
      });
    } else if (action.type === 'open-trip' && action.tripId) {
      if (!item.readAt && CATEGORY_KINDS.has(item.kind)) {
        readMutation.mutate(item.id);
      }
      router.push(`/planner?tripId=${action.tripId}`);
    } else if (action.type === 'open-friends') {
      router.push('/friends');
    }
  }

  function handleRowClick(item: InboxItemDto) {
    if (item.readAt || !CATEGORY_KINDS.has(item.kind)) return;
    readMutation.mutate(item.id);
  }

  const content = (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f.value === filter;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`h-9 rounded-full border px-3 text-[13px] font-semibold transition ${
                active
                  ? 'border-[#3182F6] bg-[#EAF2FF] text-[#1B64DA]'
                  : 'border-[#E5E8EB] bg-white text-[#6B7684] hover:bg-[#FAFBFC]'
              }`}
            >
              {f.label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => readAllMutation.mutate()}
            disabled={readAllMutation.isPending || unreadCount === 0}
            className="h-9 rounded-[10px] border border-[#E5E8EB] px-3 text-[12px] font-bold text-[#6B7684] hover:bg-[#FAFBFC] disabled:cursor-not-allowed disabled:opacity-50"
          >
            모두 읽음
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-[16px] border border-[#FECDD3] bg-[#FFECEE] p-4 text-[14px] text-[#F04452]">
          {loadError}
        </div>
      ) : null}

      {!loadError && filteredItems.length === 0 ? (
        <div className="rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC] p-6 text-center">
          <div className="text-[24px]">📭</div>
          <div className="mt-2 text-[14px] font-bold text-[#191F28]">
            {filter === 'unread'
              ? '읽지 않은 알림이 없어요'
              : filter === 'action'
                ? '응답이 필요한 알림이 없어요'
                : '받은 알림이 없어요'}
          </div>
          <div className="mt-1 text-[13px] text-[#6B7684]">
            친구를 추가하거나 여행 일정을 만들어 보세요.
          </div>
        </div>
      ) : null}

      {grouped.map((group) => (
        <section key={group.label}>
          <h2 className="px-1 pb-2 text-[12px] font-bold text-[#8B95A1]">{group.label}</h2>
          <div className="space-y-2">
            {group.items.map((item) => (
              <InboxRow
                key={item.id}
                item={item}
                pending={
                  ((acceptMutation.isPending || rejectMutation.isPending) &&
                    item.kind === 'friend_request') ||
                  ((acceptInviteMutation.isPending || rejectInviteMutation.isPending) &&
                    item.kind === 'trip_invite')
                }
                onAction={(actionType) => handleAction(item, actionType)}
                onClick={() => handleRowClick(item)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );

  return (
    <AppFrame>
      <PageHeader
        title="알림"
        label="알림"
        description="친구 요청, 재계획, 일정 알림이 모입니다."
        action={
          <>
            <Link
              href="/friends"
              className="hidden rounded-[14px] border border-[#E5E8EB] bg-white px-4 py-2 text-[14px] font-semibold text-[#191F28] hover:bg-[#FAFBFC] lg:inline-flex"
            >
              친구 목록
            </Link>
            {unreadCount > 0 ? (
              <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-[#3182F6] px-2 text-[12px] font-bold text-white lg:h-9 lg:min-w-9 lg:px-3 lg:text-[13px]">
                <span className="lg:hidden">{unreadCount}</span>
                <span className="hidden lg:inline">{unreadCount} 새 알림</span>
              </span>
            ) : null}
          </>
        }
      />
      <PageContainer>{content}</PageContainer>
    </AppFrame>
  );
}

function InboxRow({
  item,
  pending,
  onAction,
  onClick,
}: {
  item: InboxItemDto;
  pending: boolean;
  onAction: (actionType: string) => void;
  onClick: () => void;
}) {
  const meta = KIND_META[item.kind];
  const unread = !item.readAt;
  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-3 rounded-[14px] border p-3 transition ${
        unread
          ? 'border-[#BFD7FF] bg-[#F4F8FF] hover:bg-[#EAF2FF]'
          : 'border-[#E5E8EB] bg-white hover:bg-[#FAFBFC]'
      } ${CATEGORY_KINDS.has(item.kind) && unread ? 'cursor-pointer' : ''}`}
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-[18px]"
        style={{ background: `${meta.tone}1F`, color: meta.tone }}
      >
        {meta.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: meta.tone }}>
            {meta.label}
          </span>
          {unread ? (
            <span className="inline-block size-1.5 rounded-full bg-[#F04452]" aria-label="unread" />
          ) : null}
          <span className="ml-auto text-[11px] text-[#8B95A1]">{formatRelative(item.createdAt)}</span>
        </div>
        <div className="mt-0.5 text-[14px] font-bold text-[#191F28]">{item.title}</div>
        <p className="mt-0.5 text-[13px] leading-[20px] text-[#4E5968]">{item.body}</p>
        {item.actions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {item.actions.map((action) => {
              const primary =
                action.type === 'accept-friend' ||
                action.type === 'accept-trip-invite' ||
                action.type === 'open-trip';
              return (
                <button
                  key={`${action.type}:${action.label}`}
                  type="button"
                  disabled={pending}
                  onClick={(event) => {
                    event.stopPropagation();
                    onAction(action.type);
                  }}
                  className={`h-9 rounded-[10px] px-3 text-[12px] font-bold transition ${
                    primary
                      ? 'bg-[#3182F6] text-white hover:bg-[#1B64DA] disabled:opacity-50'
                      : 'border border-[#E5E8EB] text-[#6B7684] hover:bg-[#FAFBFC]'
                  }`}
                >
                  {action.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function groupByDate(items: InboxItemDto[]): Array<{ label: string; items: InboxItemDto[] }> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 6 * 86_400_000;

  const buckets: Record<string, InboxItemDto[]> = {
    '오늘': [],
    '어제': [],
    '이번 주': [],
    '그 이전': [],
  };
  for (const item of items) {
    const t = new Date(item.createdAt).getTime();
    if (t >= startOfToday) buckets['오늘']!.push(item);
    else if (t >= startOfYesterday) buckets['어제']!.push(item);
    else if (t >= startOfWeek) buckets['이번 주']!.push(item);
    else buckets['그 이전']!.push(item);
  }
  return Object.entries(buckets)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, items: list }));
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// Filter type referenced for clarity
export type { NotificationCategory };
