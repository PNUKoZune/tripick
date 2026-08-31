'use client';

import { useState } from 'react';
import { LuChevronRight, LuLockKeyhole } from 'react-icons/lu';

import type { MeUser } from '@/entities/user';
import { ChangePasswordDialog } from './change-password-dialog';
import { SetPasswordDialog } from './set-password-dialog';

type Props = {
  me: MeUser | null | undefined;
};

/**
 * 설정 화면의 비밀번호 행. 계정 종류에 따라 두 갈래다.
 * - 비밀번호가 있는 계정: 현재 비밀번호를 확인하고 바로 변경
 * - 카카오 단독 가입(비밀번호 없음): 이메일로 설정 링크 발송
 *
 * 이메일도 비밀번호도 없는 계정(카카오에서 이메일 동의를 안 받은 경우)은 어느 쪽도 할 수
 * 없어 행 자체를 감춘다 — 눌러도 막다른 길이라 없는 편이 낫다.
 */
export function PasswordSettingsRow({ me }: Props) {
  const [open, setOpen] = useState(false);

  // me 로딩 전엔 어느 갈래인지 모른다 — 잘못된 라벨을 먼저 보여주느니 그리지 않는다.
  if (!me) return null;
  if (!me.hasPassword && !me.email) return null;

  const label = me.hasPassword ? '비밀번호 변경' : '비밀번호 설정';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-2 flex h-12 w-full items-center justify-between rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-4 text-left text-[14px] font-bold text-[color:var(--ink)] hover:bg-[color:var(--card-soft)]"
      >
        <span className="flex items-center gap-2">
          <LuLockKeyhole className="size-4 text-[color:var(--ink-faint)]" aria-hidden />
          {label}
        </span>
        <LuChevronRight className="size-4 text-[color:var(--ink-faint)]" aria-hidden />
      </button>
      {open ? (
        me.hasPassword ? (
          <ChangePasswordDialog onClose={() => setOpen(false)} />
        ) : (
          <SetPasswordDialog email={me.email ?? ''} onClose={() => setOpen(false)} />
        )
      ) : null}
    </>
  );
}
