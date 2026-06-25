'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserDto } from '@tripick/types';

import { updateMe } from '@/entities/user';
import { queryKeys } from '@/shared/api/query-keys';
import { InlineEditableText } from '@/shared/ui';

type Props = {
  me: UserDto | null | undefined;
  /** mutation 에러를 상위 view 의 통합 표시 영역에서 잡고 싶을 때 사용 */
  onError?: (error: Error | null) => void;
};

export function NicknameEditor({ me, onError }: Props) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (nickname: string) => updateMe({ nickname }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.me });
      onError?.(null);
    },
    onError: (err) => onError?.(err instanceof Error ? err : null),
  });

  return (
    <InlineEditableText
      value={me?.nickname ?? ''}
      onCommit={(next) => mutation.mutate(next)}
      ariaLabel="닉네임"
      placeholder="닉네임"
      maxLength={20}
      disabled={!me}
      textClassName="text-[18px] font-bold text-[#191F28] lg:text-[22px]"
    />
  );
}
