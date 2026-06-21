'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserDto } from '@tripick/types';

import { updateMe } from '@/entities/user';
import { queryKeys } from '@/shared/api/query-keys';

type Props = {
  me: UserDto | null | undefined;
  /** mutation 에러를 상위 view 의 통합 표시 영역에서 잡고 싶을 때 사용 */
  onError?: (error: Error | null) => void;
};

export function NicknameEditor({ me, onError }: Props) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (me) setDraft(me.nickname);
  }, [me]);

  const mutation = useMutation({
    mutationFn: (nickname: string) => updateMe({ nickname }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.me });
      setEditing(false);
      onError?.(null);
    },
    onError: (err) => onError?.(err instanceof Error ? err : null),
  });

  function commit() {
    const next = draft.trim();
    if (!next || next === me?.nickname) {
      setEditing(false);
      if (me) setDraft(me.nickname);
      return;
    }
    mutation.mutate(next);
  }

  if (editing) {
    return (
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setEditing(false);
            if (me) setDraft(me.nickname);
          }
        }}
        onBlur={commit}
        maxLength={20}
        autoFocus
        className="h-11 w-full max-w-[280px] rounded-[10px] border border-[#3182F6] bg-white px-3 text-center text-[18px] font-bold text-[#191F28] outline-none ring-2 ring-[#E1ECFF] lg:max-w-[360px] lg:text-left lg:text-[22px]"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={!me}
      className="inline-flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-[18px] font-bold text-[#191F28] hover:bg-white/60 disabled:opacity-50 lg:text-[22px]"
    >
      <span className="max-w-[220px] truncate lg:max-w-[360px]">{me?.nickname ?? '—'}</span>
      <PencilIcon />
    </button>
  );
}

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[#8B95A1]"
      aria-hidden
    >
      <path d="M4 20h4l10.5-10.5a2 2 0 0 0-2.83-2.83L5.17 17.17V20Z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}
