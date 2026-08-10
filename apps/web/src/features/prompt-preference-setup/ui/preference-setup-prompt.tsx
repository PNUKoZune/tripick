'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FiCompass } from 'react-icons/fi';

import { getMyPreferences } from '@/entities/preferences/api/preferences-api';
import { getStoredSession } from '@/entities/session/model/session-storage';
import { queryKeys } from '@/shared/api/query-keys';
import { BottomSheet } from '@/shared/ui';
import { PrimaryButton, SecondaryButton } from '@/shared/ui/app-frame';

/** 취향 설정 유도 시트를 이번 세션에서 이미 닫았는지 기록하는 키 */
const DISMISS_KEY = 'tripick.pref-prompt-dismissed';

/**
 * 첫 로그인(취향 미설정) 사용자에게 홈 위에서 취향 설정을 유도하는 시트.
 * 취향을 저장하면 API가 profile 을 채워 반환하므로 자연스럽게 더 이상 뜨지 않는다.
 * 이번 세션에서 "나중에" 를 누르면 sessionStorage 플래그로 재노출을 막는다.
 */
export function PreferenceSetupPrompt() {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage 닫힘 플래그를 마운트 후 반영(SSR-safe)
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  const preferenceQuery = useQuery({
    queryKey: queryKeys.preferences.me,
    queryFn: async () => {
      const session = getStoredSession();
      if (!session) return null;
      return getMyPreferences(session.tokens.accessToken);
    },
    staleTime: 5 * 60 * 1000,
  });

  const needsSetup = preferenceQuery.isSuccess && !preferenceQuery.data?.profile;
  const open = needsSetup && !dismissed;

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  function goToSetup() {
    dismiss();
    router.push('/preferences');
  }

  return (
    <BottomSheet open={open} onClose={dismiss} label="취향 설정 안내" themed>
      <div className="flex flex-col items-center px-1 pb-1 pt-4 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-[color:var(--blue-50,#EAF2FF)] text-[color:var(--blue-600,#3182F6)]">
          <FiCompass className="size-8" aria-hidden />
        </span>
        <h2 className="mt-4 text-[20px] font-black leading-7 text-[color:var(--ink,#191F28)]">
          취향부터 설정해 볼까요?
        </h2>
        <p className="mt-2 text-[14px] font-medium leading-[21px] text-[color:var(--ink-sub,#6B7684)]">
          좋아하는 여행 스타일을 알려주면
          <br />
          일정 추천이 훨씬 잘 맞아져요. 1분이면 끝나요.
        </p>

        <div className="mt-6 w-full space-y-2.5">
          <PrimaryButton onClick={goToSetup}>취향 설정하러 가기</PrimaryButton>
          <SecondaryButton onClick={dismiss}>나중에 하기</SecondaryButton>
        </div>
      </div>
    </BottomSheet>
  );
}
