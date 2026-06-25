'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserDto } from '@tripick/types';

import { updateMe } from '@/entities/user';
import { queryKeys } from '@/shared/api/query-keys';
import { InlineEditableText } from '@/shared/ui';

const HANDLE_REGEX = /^[a-z0-9_]{3,20}$/;

type Props = {
  me: UserDto | null | undefined;
  /** mutation/검증 에러를 상위 view 의 통합 표시 영역에서 잡고 싶을 때 사용 */
  onError?: (error: Error | null) => void;
};

/**
 * 사용자 고유 식별자(코드상 handle) 편집. UI 문구는 일반 사용자가 바로 이해하도록 "아이디" 로 노출하고,
 * @ 접두사로 "검색용 고유 아이디" 임을 시각적으로 알린다.
 */
export function HandleEditor({ me, onError }: Props) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (handle: string) => updateMe({ handle }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.me });
      onError?.(null);
    },
    onError: (err) => onError?.(err instanceof Error ? err : null),
  });

  function commit(next: string) {
    if (!HANDLE_REGEX.test(next)) {
      onError?.(new Error('아이디는 영문 소문자·숫자·밑줄 3~20자로 입력해주세요.'));
      return;
    }
    mutation.mutate(next);
  }

  return (
    <InlineEditableText
      value={me?.handle ?? ''}
      onCommit={commit}
      ariaLabel="아이디"
      prefix="@"
      placeholder="아이디"
      maxLength={20}
      disabled={!me}
      sanitize={(raw) => raw.toLowerCase().replace(/[^a-z0-9_]/g, '')}
      textClassName="text-[13px] font-semibold text-[#8B95A1] lg:text-[14px]"
    />
  );
}
