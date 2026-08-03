'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LuCheck, LuCopy, LuPlane, LuSearch, LuStar, LuUserPlus, LuX } from 'react-icons/lu';
import type { FriendDto } from '@tripick/types';

import {
  acceptFriend,
  addFriend,
  FriendRow,
  fetchFriends,
  removeFriend,
  togglePinFriend,
} from '@/entities/friend';
import { getStoredSession, SessionGuard } from '@/entities/session';
import { queryKeys } from '@/shared/api/query-keys';
import { AppFrame, PageContainer, PageHeader } from '@/shared/ui/app-frame';

export function FriendsView() {
  return (
    <SessionGuard>
      <FriendsContent />
    </SessionGuard>
  );
}

// 서버 스냅샷 null → 하이드레이션 불일치 없이 마운트 후 실제 핸들로 재렌더 (useHasSession 과 동일 패턴).
const noopSubscribe = () => () => {};

function FriendsContent() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [addInput, setAddInput] = useState('');
  const myHandle = useSyncExternalStore(
    noopSubscribe,
    () => getStoredSession()?.user.handle ?? null,
    () => null,
  );

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

  const { pinned, others, incoming, sent } = useMemo(() => {
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
      sent: filtered.filter((f) => f.status === 'pending'),
    };
  }, [friends, search]);

  function handleAdd() {
    const handle = addInput.trim();
    if (!handle) return;
    addMutation.mutate({ handle }, { onSuccess: () => setAddInput('') });
  }

  const goCreateTrip = (friendId: string) => router.push(`/trips/new?friendId=${friendId}`);

  const content = (
    <div className="space-y-4">
      {myHandle ? <MyHandleShare handle={myHandle} /> : null}

      <div className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card)] p-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-6 items-center justify-center rounded-full bg-[color:var(--primary-tint)] text-[color:var(--primary)]"
          >
            <LuUserPlus className="size-3.5" />
          </span>
          <span className="text-[13px] font-bold text-[color:var(--ink)]">친구 추가</span>
        </div>
        <p className="mt-1 text-[12px] text-[color:var(--ink-faint)]">
          상대방의 아이디(@)로 친구 요청을 보냅니다. 상대가 수락하면 친구가 돼요.
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
            className="h-11 flex-1 rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-3 text-[14px] font-medium text-[color:var(--ink)] outline-none placeholder:text-[color:var(--ink-faint)] focus:border-[color:var(--primary)]"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!addInput.trim() || addMutation.isPending}
            className="h-11 rounded-[12px] bg-[color:var(--btn-bg)] px-4 text-[13px] font-bold text-[color:var(--btn-text)] transition hover:bg-[color:var(--btn-bg-press)] disabled:bg-[color:var(--line)] disabled:text-[color:var(--ink-faint)]"
          >
            요청
          </button>
        </div>
        {mutationError ? (
          <p className="mt-2 text-[12px] font-semibold text-[color:var(--danger)]">
            {mutationError}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2 rounded-[14px] bg-[color:var(--card-soft)] px-4 py-2.5">
        <LuSearch className="size-4 shrink-0 text-[color:var(--ink-faint)]" aria-hidden />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="이름 또는 ID 검색"
          className="h-7 w-full bg-transparent text-[14px] font-semibold text-[color:var(--ink)] outline-none placeholder:text-[color:var(--ink-faint)]"
        />
      </div>

      {loadError ? (
        <div className="rounded-[16px] border border-[color:var(--danger-border)] bg-[color:var(--danger-tint)] p-4 text-[14px] text-[color:var(--danger)]">
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
                    className="h-9 rounded-[10px] bg-[color:var(--btn-bg)] px-3 text-[12px] font-bold text-[color:var(--btn-text)] hover:bg-[color:var(--btn-bg-press)]"
                  >
                    수락
                  </button>
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(friend.id)}
                    aria-label={`${friend.nickname} 요청 거절`}
                    className="h-9 rounded-[10px] border border-[color:var(--line)] px-3 text-[12px] font-bold text-[color:var(--ink-sub)] hover:bg-[color:var(--card-soft)]"
                  >
                    거절
                  </button>
                </div>
              }
            />
          ))}
        </FriendSection>
      ) : null}

      {sent.length > 0 ? (
        <FriendSection title="보낸 요청" count={sent.length}>
          {sent.map((friend) => (
            <FriendRow
              key={friend.id}
              friend={friend}
              trailing={
                <div className="flex items-center gap-2">
                  <span className="rounded-[8px] bg-[color:var(--card-soft)] px-2 py-1 text-[11px] font-bold text-[color:var(--ink-faint)]">
                    수락 대기
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(friend.id)}
                    aria-label={`${friend.nickname} 요청 취소`}
                    className="h-9 rounded-[10px] border border-[color:var(--line)] px-3 text-[12px] font-bold text-[color:var(--ink-sub)] hover:bg-[color:var(--card-soft)]"
                  >
                    요청 취소
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
                  onCreateTrip={goCreateTrip}
                />
              }
            />
          ))}
        </FriendSection>
      ) : null}

      <FriendSection title="친구" count={others.length}>
        {others.length === 0 && !loadError ? (
          <p className="px-4 py-6 text-center text-[13px] text-[color:var(--ink-faint)]">
            친구가 없어요. 핸들(@아이디)로 친구를 추가해보세요.
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
                  onCreateTrip={goCreateTrip}
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
      {/* 취향·알림·설정과 같은 "광안리의 하루" 팔레트를 이 화면에도 로컬 스코프로 적용한다. */}
      <div className="wvr-scope min-h-dvh">
        <PageHeader
          title="친구"
          label="친구"
          description="카카오톡 친구 추가하듯, 아이디(@)로 친구를 추가하고 여행 멤버 후보로 둡니다."
          action={
            friends.length > 0 ? (
              <span className="text-[13px] font-semibold text-[color:var(--ink-sub)]">
                전체 {friends.length}명
              </span>
            ) : null
          }
        />
        <PageContainer>{content}</PageContainer>
      </div>
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
    <section className="overflow-hidden rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card)]">
      <div className="flex items-center justify-between border-b border-[color:var(--line)] bg-[color:var(--card-soft)] px-4 py-2.5">
        <h2 className="text-[13px] font-bold text-[color:var(--ink)]">{title}</h2>
        <span className="text-[12px] font-semibold text-[color:var(--ink-faint)]">{count}</span>
      </div>
      <div className="divide-y divide-[color:var(--line)]">{children}</div>
    </section>
  );
}

function FriendRowMenu({
  friend,
  onPin,
  onRemove,
  onCreateTrip,
}: {
  friend: FriendDto;
  onPin: (id: string) => void;
  onRemove: (id: string) => void;
  onCreateTrip: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onCreateTrip(friend.id)}
        aria-label={`${friend.nickname}와(과) 여행 만들기`}
        className="flex size-9 items-center justify-center rounded-[10px] text-[color:var(--ink-faint)] transition hover:bg-[color:var(--primary-tint)] hover:text-[color:var(--primary)]"
      >
        <LuPlane className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => onPin(friend.id)}
        aria-label={friend.pinned ? '즐겨찾기 해제' : '즐겨찾기'}
        className={`flex size-9 items-center justify-center rounded-[10px] transition ${
          friend.pinned
            ? 'text-[color:var(--accent-deep)]'
            : 'text-[color:var(--ink-faint)] hover:bg-[color:var(--accent-tint)] hover:text-[color:var(--accent-deep)]'
        }`}
      >
        {/* 켜짐은 채운 별, 꺼짐은 빈 별 — ★/☆ 문자는 폰트마다 크기·정렬이 달라 아이콘으로. */}
        <LuStar className={`size-4 ${friend.pinned ? 'fill-current' : ''}`} />
      </button>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`${friend.nickname}을(를) 친구 목록에서 삭제할까요?`)) {
            onRemove(friend.id);
          }
        }}
        aria-label={`${friend.nickname} 삭제`}
        className="flex size-9 items-center justify-center rounded-[10px] text-[color:var(--ink-faint)] transition hover:bg-[color:var(--danger-tint)] hover:text-[color:var(--danger)]"
      >
        <LuX className="size-4" />
      </button>
    </div>
  );
}

function MyHandleShare({ handle }: { handle: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`@${handle}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 미지원/거부 시 조용히 무시 (사용자는 텍스트를 직접 복사 가능)
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card)] px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-[color:var(--ink-faint)]">내 아이디</div>
        <div className="truncate text-[15px] font-bold text-[color:var(--ink)]">@{handle}</div>
      </div>
      <button
        type="button"
        onClick={copy}
        className="flex h-9 items-center gap-1.5 rounded-[10px] bg-[color:var(--card-soft)] px-3 text-[12px] font-bold text-[color:var(--ink-sub)] transition hover:bg-[color:var(--line)]"
      >
        {copied ? (
          <>
            <LuCheck className="size-4 text-[color:var(--ok)]" />
            복사됨
          </>
        ) : (
          <>
            <LuCopy className="size-4" />
            복사
          </>
        )}
      </button>
    </div>
  );
}
