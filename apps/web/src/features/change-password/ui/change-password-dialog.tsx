'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { changePassword } from '@/entities/session/api/auth-api';
import { useRetryCountdown } from '@/shared/lib';
import { Button, ModalShell } from '@/shared/ui';

type Props = {
  onClose: () => void;
};

/**
 * 로그인 상태에서의 비밀번호 변경. 현재 비밀번호를 함께 받는다 — 서버가 이 값으로 본인을
 * 다시 확인하고, 성공하면 다른 기기의 세션을 전부 끊는다(이 기기는 새 토큰으로 이어진다).
 *
 * ModalShell 은 body 로 portal 되어 설정 화면의 `.wvr-scope` 밖에 렌더된다 — 다크 토큰이
 * 폴백(라이트)으로 굳지 않도록 패널에 직접 스코프를 건다.
 */
export function ChangePasswordDialog({ onClose }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => setDone(true),
  });

  // 429 를 맞으면 Retry-After 만큼 재시도를 막는다(서버가 어차피 거절할 요청).
  const retryAfter = useRetryCountdown(mutation.error);

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit =
    current.length > 0 &&
    next.length >= 8 &&
    next === confirm &&
    !mutation.isPending &&
    retryAfter === 0;
  const errorMessage = mutation.error instanceof Error ? mutation.error.message : null;

  return (
    <ModalShell
      label="비밀번호 변경"
      onDismiss={mutation.isPending ? undefined : onClose}
      panelClassName="wvr-scope w-full max-w-[400px] rounded-[20px] bg-[color:var(--card,#FFFFFF)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]"
    >
      {done ? (
        <>
          <h2 className="text-[18px] font-bold text-[color:var(--ink,#191F28)]">
            비밀번호를 바꿨어요
          </h2>
          <p className="mt-2 text-[13px] leading-[20px] text-[color:var(--ink-sub,#4E5968)]">
            이 기기는 그대로 로그인 상태예요. 보안을 위해 다른 기기의 로그인은 모두
            해제됐으니, 새 비밀번호로 다시 로그인해주세요.
          </p>
          <Button size="md" fullWidth className="mt-5" onClick={onClose}>
            확인
          </Button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
        >
          <h2 className="text-[18px] font-bold text-[color:var(--ink,#191F28)]">비밀번호 변경</h2>
          <p className="mt-2 text-[13px] leading-[20px] text-[color:var(--ink-sub,#4E5968)]">
            본인 확인을 위해 지금 쓰는 비밀번호를 함께 입력해주세요.
          </p>

          <div className="mt-4 space-y-3">
            <Field
              id="current-password"
              label="현재 비밀번호"
              value={current}
              autoComplete="current-password"
              disabled={mutation.isPending}
              onChange={setCurrent}
            />
            <Field
              id="new-password"
              label="새 비밀번호"
              value={next}
              autoComplete="new-password"
              disabled={mutation.isPending}
              hint="8자 이상, 영문+숫자 포함"
              onChange={setNext}
            />
            <Field
              id="new-password-confirm"
              label="새 비밀번호 확인"
              value={confirm}
              autoComplete="new-password"
              disabled={mutation.isPending}
              error={mismatch ? '비밀번호가 일치하지 않아요.' : null}
              onChange={setConfirm}
            />
          </div>

          {errorMessage ? (
            <p
              role="alert"
              className="mt-3 text-[13px] leading-[20px] font-semibold text-[color:var(--danger,#F04452)]"
            >
              {errorMessage}
            </p>
          ) : null}

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
            <Button type="submit" size="md" fullWidth disabled={!canSubmit}>
              {mutation.isPending
                ? '변경 중…'
                : retryAfter > 0
                  ? `${retryAfter}초 후 다시 시도`
                  : '변경하기'}
            </Button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}

function Field({
  id,
  label,
  value,
  autoComplete,
  disabled,
  hint,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  autoComplete: string;
  disabled: boolean;
  hint?: string;
  error?: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-[13px] font-bold text-[color:var(--ink,#191F28)]">
        {label}
      </span>
      <input
        id={id}
        type="password"
        value={value}
        disabled={disabled}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-[12px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#FFFFFF)] px-3 text-[15px] text-[color:var(--ink,#191F28)] outline-none focus:border-[color:var(--primary,#3182F6)] disabled:opacity-50"
      />
      {error ? (
        <span className="mt-1 block text-[12px] font-semibold text-[color:var(--danger,#F04452)]">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[12px] text-[color:var(--ink-faint,#8B95A1)]">{hint}</span>
      ) : null}
    </label>
  );
}
