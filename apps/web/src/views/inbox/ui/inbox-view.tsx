'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LuCheckCheck,
  LuCircleCheck,
  LuCloudRain,
  LuInbox,
  LuLuggage,
  LuMapPin,
  LuPencilLine,
  LuSparkles,
  LuTicket,
  LuUserPlus,
  LuUsers,
} from 'react-icons/lu';
import type { IconType } from 'react-icons';
import type { InboxItemDto, InboxItemKind, NotificationCategory } from '@tripick/types';

import { acceptFriend, removeFriend } from '@/entities/friend';
import { fetchInbox, markAllInboxRead, markInboxRead } from '@/entities/inbox';
import { SessionGuard } from '@/entities/session';
import { acceptTripInvite, rejectTripInvite } from '@/entities/trip-plan';
import { rejectScheduleChange } from '@/entities/schedule-change';
import { useInboxInvalidateSubscription } from '@/features/subscribe-inbox-invalidate';
import { queryKeys } from '@/shared/api/query-keys';
import { AppFrame, PageContainer, PageHeader } from '@/shared/ui/app-frame';

type Filter = 'all' | 'unread' | 'action';
/** 카테고리 sub-filter 값. 'all' 이면 카테고리 제한 없음. */
type KindFilter = InboxItemKind | 'all';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'unread', label: '읽지 않음' },
  { value: 'action', label: '응답 필요' },
];

/**
 * 알림 종류별 아이콘·색. 이모지는 기기·OS 마다 모양과 폭이 달라 목록 정렬이 흔들리고
 * 이모지 폰트가 없는 환경에선 두부 글자가 되므로 react-icons 로 통일한다.
 * tone 은 hex 가 아니라 "광안리의 하루" 팔레트 변수 — 라이트/다크가 토큰 한 곳에서 갈린다.
 */
const KIND_META: Record<InboxItemKind, { Icon: IconType; label: string; tone: string }> = {
  friend_request: { Icon: LuUserPlus, label: '친구 요청', tone: 'var(--primary)' },
  trip_invite: { Icon: LuTicket, label: '여행 초대', tone: 'var(--primary-deep)' },
  replan_ready: { Icon: LuSparkles, label: '재계획 알림', tone: 'var(--ok)' },
  weather_alert: { Icon: LuCloudRain, label: '날씨 알림', tone: 'var(--accent-deep)' },
  crowd_alert: { Icon: LuUsers, label: '혼잡 알림', tone: 'var(--accent-deep)' },
  arrival_alert: { Icon: LuMapPin, label: '미도착 알림', tone: 'var(--danger)' },
  trip_reminder: { Icon: LuLuggage, label: '여행 알림', tone: 'var(--primary)' },
  schedule_change_request: { Icon: LuPencilLine, label: '변경 요청', tone: 'var(--accent-deep)' },
  schedule_change_result: { Icon: LuCircleCheck, label: '변경 결과', tone: 'var(--ok)' },
  general: { Icon: LuInbox, label: '알림', tone: 'var(--ink-sub)' },
};

/**
 * 서버는 알림 제목 앞에 이모지를 붙인다(예: `📍 1일차 — 광안리 미도착`). FCM 푸시
 * 잠금화면에선 그 이모지가 눈길을 끌어 쓸모가 있지만, 인박스 목록은 왼쪽에 종류
 * 아이콘이 따로 있어 중복이고 이모지 폰트가 없는 환경에선 두부 글자가 된다.
 * 그래서 **표시할 때만** 선행 이모지를 떼고, 서버 문구(=푸시 제목)는 건드리지 않는다.
 */
const LEADING_EMOJI = /^(?:\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*\s*)+/u;

function stripLeadingEmoji(text: string): string {
  return text.replace(LEADING_EMOJI, '').trimStart();
}

const CATEGORY_KINDS: Set<InboxItemKind> = new Set([
  'replan_ready',
  'weather_alert',
  'crowd_alert',
  'arrival_alert',
  'trip_reminder',
  'schedule_change_result',
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
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');

  // WebSocket 신호로 새 알림 도착 시 목록을 실시간 갱신한다(브라우저 단독 FCM 공백 보완).
  useInboxInvalidateSubscription();

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
  const rejectScheduleChangeMutation = useMutation({
    mutationFn: (proposalId: string) => rejectScheduleChange(proposalId),
    onSuccess: () => invalidate(),
  });

  // 지금 받은 알림에 실제로 존재하는 카테고리만 chip 으로 노출한다(빈 카테고리 숨김).
  const availableKinds = useMemo(() => {
    const seen = new Set<InboxItemKind>();
    for (const item of items) seen.add(item.kind);
    return (Object.keys(KIND_META) as InboxItemKind[]).filter((kind) => seen.has(kind));
  }, [items]);

  // 현재 목록에 없는 카테고리가 선택돼 있으면(읽음 처리 등으로 사라짐) 전체로 되돌린다.
  // effect 대신 렌더 단계에서 조정한다 — 조정 후 조건이 거짓이 되어 무한 루프가 없다.
  if (kindFilter !== 'all' && !availableKinds.includes(kindFilter)) {
    setKindFilter('all');
  }

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
      if (filter === 'unread') return !item.readAt;
      // '응답 필요' = 수락/거절처럼 사용자 응답을 기다리는 액션이 있는 것만. 딥링크(open-*)는
      // 제외 — 서버가 tripId 붙은 알림 대부분에 '여행 보기' 를 달아주므로 액션 유무로 세면
      // 전체 목록과 같아진다. 판정 정본은 서버가 실어 보내는 requiresResponse.
      if (filter === 'action') return item.actions.some((action) => action.requiresResponse);
      return true;
    });
  }, [items, filter, kindFilter]);

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
    } else if (action.type === 'review-schedule-change' && action.tripId && action.proposalId) {
      // owner: planner 로 이동해 diff 를 확인하고 그 화면에서 승인/거절한다.
      if (!item.readAt) readMutation.mutate(item.id);
      const dayQuery = action.day ? `&day=${action.day}` : '';
      router.push(`/planner?tripId=${action.tripId}${dayQuery}&proposalId=${action.proposalId}`);
    } else if (action.type === 'reject-schedule-change' && action.proposalId) {
      if (!item.readAt) readMutation.mutate(item.id);
      rejectScheduleChangeMutation.mutate(action.proposalId);
    } else if (action.type === 'open-trip' && action.tripId) {
      if (!item.readAt && CATEGORY_KINDS.has(item.kind)) {
        readMutation.mutate(item.id);
      }
      // 알림에 일차가 실려 있으면 그 일차로 딥링크한다(날씨·혼잡·미도착 알림).
      const dayQuery = action.day ? `&day=${action.day}` : '';
      // 알림이 재계획을 권하는 경우, 트리거를 실어 planner 가 비침습 배너로 제안하게 한다
      // (자동 재계획 없음 — 사용자가 배너를 눌러야 모달이 열린다).
      const replanQuery = action.replan ? `&replan=${action.replan}` : '';
      router.push(`/planner?tripId=${action.tripId}${dayQuery}${replanQuery}`);
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
                  ? 'border-[color:var(--primary)] bg-[color:var(--primary-tint)] text-[color:var(--primary-deep)]'
                  : 'border-[color:var(--line)] bg-[color:var(--card)] text-[color:var(--ink-sub)] hover:bg-[color:var(--card-soft)]'
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
            className="flex h-9 items-center gap-1.5 rounded-[10px] border border-[color:var(--line)] px-3 text-[12px] font-bold text-[color:var(--ink-sub)] transition hover:bg-[color:var(--card-soft)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LuCheckCheck className="size-3.5" aria-hidden />
            모두 읽음
          </button>
        </div>
      </div>

      {availableKinds.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <CategoryChip
            label="전체"
            active={kindFilter === 'all'}
            onClick={() => setKindFilter('all')}
          />
          {availableKinds.map((kind) => (
            <CategoryChip
              key={kind}
              label={KIND_META[kind].label}
              Icon={KIND_META[kind].Icon}
              tone={KIND_META[kind].tone}
              active={kindFilter === kind}
              onClick={() => setKindFilter(kind)}
            />
          ))}
        </div>
      ) : null}

      {loadError ? (
        <div className="rounded-[16px] border border-[color:var(--danger-border)] bg-[color:var(--danger-tint)] p-4 text-[14px] text-[color:var(--danger)]">
          {loadError}
        </div>
      ) : null}

      {!loadError && filteredItems.length === 0 ? (
        <div className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card-soft)] p-6 text-center">
          <LuInbox className="mx-auto size-6 text-[color:var(--ink-faint)]" aria-hidden />
          <div className="mt-2 text-[14px] font-bold text-[color:var(--ink)]">
            {filter === 'unread'
              ? '읽지 않은 알림이 없어요'
              : filter === 'action'
                ? '응답이 필요한 알림이 없어요'
                : '받은 알림이 없어요'}
          </div>
          <div className="mt-1 text-[13px] text-[color:var(--ink-sub)]">
            친구를 추가하거나 여행 일정을 만들어 보세요.
          </div>
        </div>
      ) : null}

      {grouped.map((group) => (
        <section key={group.label}>
          <h2 className="px-1 pb-2 text-[12px] font-bold text-[color:var(--ink-faint)]">
            {group.label}
          </h2>
          <div className="space-y-2">
            {group.items.map((item) => (
              <InboxRow
                key={item.id}
                item={item}
                pending={
                  ((acceptMutation.isPending || rejectMutation.isPending) &&
                    item.kind === 'friend_request') ||
                  ((acceptInviteMutation.isPending || rejectInviteMutation.isPending) &&
                    item.kind === 'trip_invite') ||
                  (rejectScheduleChangeMutation.isPending &&
                    item.kind === 'schedule_change_request')
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
    <AppFrame themed>
      <PageHeader
        title="알림"
        label="알림"
        description="친구 요청, 재계획, 일정 알림이 모입니다."
        action={
          <>
            <Link
              href="/friends"
              className="hidden rounded-[14px] border border-[color:var(--line)] bg-[color:var(--card)] px-4 py-2 text-[14px] font-semibold text-[color:var(--ink)] hover:bg-[color:var(--card-soft)] lg:inline-flex"
            >
              친구 목록
            </Link>
            {unreadCount > 0 ? (
              <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-[color:var(--primary)] px-2 text-[12px] font-bold text-[color:var(--btn-text)] lg:h-9 lg:min-w-9 lg:px-3 lg:text-[13px]">
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

function CategoryChip({
  label,
  Icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  /** 카테고리 칩에만 있고 "전체" 칩엔 없다. */
  Icon?: IconType;
  tone?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-semibold transition ${
        active
          ? 'border-[color:var(--primary)] bg-[color:var(--primary-tint)] text-[color:var(--primary-deep)]'
          : 'border-[color:var(--line)] bg-[color:var(--card)] text-[color:var(--ink-sub)] hover:bg-[color:var(--card-soft)]'
      }`}
    >
      {Icon ? (
        <Icon
          className="size-3.5 shrink-0"
          style={active ? undefined : { color: tone }}
          aria-hidden
        />
      ) : null}
      {label}
    </button>
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
  const Icon = meta.Icon;
  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-3 rounded-[14px] border p-3 transition ${
        unread
          ? 'border-[color:var(--primary-tint)] bg-[color:var(--primary-tint)]'
          : 'border-[color:var(--line)] bg-[color:var(--card)] hover:bg-[color:var(--card-soft)]'
      } ${CATEGORY_KINDS.has(item.kind) && unread ? 'cursor-pointer' : ''}`}
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full"
        style={{
          // 아이콘 색을 그대로 옅게 깔아 종류별 톤을 유지한다(라이트/다크 모두 토큰 기반).
          background: `color-mix(in srgb, ${meta.tone} 16%, transparent)`,
          color: meta.tone,
        }}
      >
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold tracking-wide" style={{ color: meta.tone }}>
            {meta.label}
          </span>
          {unread ? (
            <span
              className="inline-block size-1.5 rounded-full bg-[color:var(--danger)]"
              aria-label="unread"
            />
          ) : null}
          <span className="ml-auto text-[11px] text-[color:var(--ink-faint)]">
            {formatRelative(item.createdAt)}
          </span>
        </div>
        <div className="mt-0.5 text-[14px] font-bold text-[color:var(--ink)]">
          {stripLeadingEmoji(item.title)}
        </div>
        <p className="mt-0.5 text-[13px] leading-[20px] text-[color:var(--ink-sub)]">{item.body}</p>
        {item.actions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {item.actions.map((action) => {
              const primary =
                action.type === 'accept-friend' ||
                action.type === 'accept-trip-invite' ||
                action.type === 'review-schedule-change' ||
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
                      ? 'bg-[color:var(--btn-bg)] text-[color:var(--btn-text)] hover:bg-[color:var(--btn-bg-press)] disabled:opacity-50'
                      : 'border border-[color:var(--line)] bg-[color:var(--card)] text-[color:var(--ink-sub)] hover:bg-[color:var(--card-soft)]'
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
    오늘: [],
    어제: [],
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
