'use client';

import { useMutation } from '@tanstack/react-query';

import { requestPasswordReset } from '@/entities/session/api/auth-api';
import { useRetryCountdown } from '@/shared/lib';
import { Button, ModalShell } from '@/shared/ui';

type Props = {
  email: string;
  onClose: () => void;
};

/**
 * 아직 비밀번호가 없는 계정(카카오 단독 가입)의 최초 설정. 여기서 바로 받지 않고 재설정
 * 메일로 보낸다 — 대조할 현재 비밀번호가 없어서 화면에서 바로 정하면 확인 수단이 세션
 * 하나뿐이고, 잠깐 열어 둔 기기가 그대로 계정 인수로 이어진다. 메일 링크는 계정 주인에게만
 * 간다.
 */
export function SetPasswordDialog({ email, onClose }: Props) {
  const mutation = useMutation({
    mutationFn: () => requestPasswordReset(email),
  });

  // 메일 발송은 분당 3회라 429 가 잘 난다. Retry-After 만큼 재시도를 막는다.
  const retryAfter = useRetryCountdown(mutation.error);
  const errorMessage = mutation.error instanceof Error ? mutation.error.message : null;
  const sent = mutation.isSuccess;

  return (
    <ModalShell
      label="비밀번호 설정"
      onDismiss={mutation.isPending ? undefined : onClose}
      panelClassName="wvr-scope w-full max-w-[400px] rounded-[20px] bg-[color:var(--card,#FFFFFF)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]"
    >
      <h2 className="text-[18px] font-bold text-[color:var(--ink,#191F28)]">
        {sent ? '메일을 보냈어요' : '비밀번호 설정'}
      </h2>
      <p className="mt-2 text-[13px] leading-[20px] text-[color:var(--ink-sub,#4E5968)]">
        {sent ? (
          <>
            <span className="font-bold text-[color:var(--ink,#191F28)]">{email}</span> 으로 설정
            링크를 보냈어요. 메일함을 확인해 1시간 안에 비밀번호를 정해주세요.
          </>
        ) : (
          <>
            카카오로 가입한 계정이라 아직 비밀번호가 없어요. 본인 확인을 위해{' '}
            <span className="font-bold text-[color:var(--ink,#191F28)]">{email}</span> 으로 설정
            링크를 보내드릴게요.
          </>
        )}
      </p>

      {errorMessage ? (
        <p
          role="alert"
          className="mt-3 text-[13px] leading-[20px] font-semibold text-[color:var(--danger,#F04452)]"
        >
          {errorMessage}
        </p>
      ) : null}

      {sent ? (
        <Button size="md" fullWidth className="mt-5" onClick={onClose}>
          확인
        </Button>
      ) : (
        <div className="mt-5 flex items-center gap-2">
          <Button
            variant="secondary"
            size="md"
            fullWidth
            disabled={mutation.isPending}
            onClick={onClose}
          >
            취소
          </Button>
          <Button
            size="md"
            fullWidth
            disabled={mutation.isPending || retryAfter > 0}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? '보내는 중…'
              : retryAfter > 0
                ? `${retryAfter}초 후 다시 시도`
                : '메일 보내기'}
          </Button>
        </div>
      )}
    </ModalShell>
  );
}
