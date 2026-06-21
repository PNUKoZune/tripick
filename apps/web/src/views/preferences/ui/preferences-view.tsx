'use client';

import { PreferenceSetupForm } from '@/features/preference-setup/ui/preference-setup-form';
import { AppBottomNavigation, AppDesktopNavigation } from '@/shared/ui/app-frame';

export function PreferencesView() {
  return (
    <div className="min-h-dvh bg-[#F7F8FA]">
      {/* < lg : 폰 셸 */}
      <div className="mx-auto min-h-dvh max-w-[430px] bg-white pb-[88px] lg:hidden">
        <header className="flex items-center px-4 pb-3 pt-5">
          <h1 className="text-[20px] font-bold text-[#191F28]">취향 설정</h1>
        </header>
        <div className="px-4 pt-2">
          <PreferenceSetupForm />
        </div>
      </div>
      <AppBottomNavigation className="lg:hidden" />

      {/* ≥ lg : 데스크탑 */}
      <div className="mx-auto hidden w-full max-w-[1440px] lg:grid lg:min-h-dvh lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6 lg:px-6">
        <AppDesktopNavigation />
        <div className="min-h-dvh border-x border-[#E5E8EB] bg-white">
          <header className="border-b border-[#E5E8EB] bg-white">
            <div className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-6 px-8 py-4 xl:px-10">
              <div>
                <div className="text-[12px] font-semibold tracking-wide text-[#3182F6]">
                  Tripick · 취향
                </div>
                <h1 className="mt-0.5 text-[22px] font-bold leading-[30px] text-[#191F28]">
                  여행 스타일 / 동행 / 이동수단
                </h1>
                <p className="mt-1 text-[13px] text-[#6B7684]">
                  내 취향을 저장하면 일정 추천이 더 잘 맞아져요.
                </p>
              </div>
            </div>
          </header>
          <div className="mx-auto w-full max-w-[1160px] px-8 py-6 xl:px-10">
            <PreferenceSetupForm />
          </div>
        </div>
      </div>
    </div>
  );
}
