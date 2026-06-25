'use client';

import { GuestGuard } from '@/entities/session';
import { EmailLoginForm } from '@/features/email-login';
import { redirectToKakao } from '@/entities/session/api/auth-api';
import { AppFrame } from '@/shared/ui/app-frame';

export function LoginView() {
  return (
    <GuestGuard>
      <LoginContent />
    </GuestGuard>
  );
}

function LoginContent() {
  return (
    <AppFrame showNav={false}>
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pb-10 pt-12">
        <header className="mb-8">
          <div className="text-[13px] font-black text-[#3182F6]">TriPick</div>
          <h1 className="mt-2 text-[26px] font-bold text-[#191F28]">로그인</h1>
          <p className="mt-1 text-[13px] text-[#6B7684]">
            여행 일정과 친구 목록이 계정과 함께 저장돼요.
          </p>
        </header>

        <EmailLoginForm next="/" />

        <div className="mt-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-[#E5E8EB]" />
          <span className="text-[12px] font-semibold text-[#8B95A1]">또는</span>
          <div className="h-px flex-1 bg-[#E5E8EB]" />
        </div>

        <button
          type="button"
          onClick={redirectToKakao}
          className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-[#FEE500] text-[15px] font-bold text-[#191919] hover:bg-[#FFDC00]"
        >
          <span aria-hidden>💬</span>
          <span>카카오로 계속하기</span>
        </button>
      </div>
    </AppFrame>
  );
}
