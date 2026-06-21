'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchMe } from '@/entities/user';
import { DeleteAccountButton } from '@/features/delete-account';
import { SignOutButton } from '@/features/sign-out';
import { NotificationPreferencesList } from '@/features/update-notification-preferences';
import { queryKeys } from '@/shared/api/query-keys';
import { firstErrorMessage } from '@/shared/lib';
import { AppBottomNavigation, AppDesktopNavigation } from '@/shared/ui/app-frame';
import { SettingsProfileHero } from '@/widgets/settings-profile-hero';

const APP_VERSION = '0.1.0';

export function SettingsView() {
  const { data: me, error } = useQuery({
    queryKey: queryKeys.user.me,
    queryFn: fetchMe,
    staleTime: 60 * 1000,
  });
  const loadError = error instanceof Error ? error.message : null;

  // 여러 feature 의 mutation 에러를 한 곳에 모아 표시
  const [featureErrors, setFeatureErrors] = useState<Record<string, Error | null>>({});
  const setError = (key: string) => (err: Error | null) =>
    setFeatureErrors((prev) => ({ ...prev, [key]: err }));
  const mutationError = firstErrorMessage(Object.values(featureErrors));

  const content = (
    <div className="space-y-6">
      <section>
        <div className="mb-2 px-1">
          <h2 className="text-[15px] font-bold text-[#191F28]">프로필</h2>
          <p className="mt-0.5 text-[12px] leading-[18px] text-[#8B95A1]">
            다른 멤버와 친구에게 보이는 정보예요.
          </p>
        </div>
        <SettingsProfileHero me={me} onError={setError('profile')} />
      </section>

      <Section
        title="알림 설정"
        description="끄면 인박스와 푸시 모두 받지 않아요. 친구 요청은 친구 페이지에선 계속 보여요."
      >
        <NotificationPreferencesList me={me} onError={setError('notifications')} />
      </Section>

      <Section title="약관 및 정책">
        <LinkRow href="#terms" label="이용약관" />
        <LinkRow href="#privacy" label="개인정보처리방침" />
        <LinkRow href="#contact" label="고객센터" />
      </Section>

      <Section title="앱 정보">
        <InfoRow label="버전" value={APP_VERSION} />
        <InfoRow
          label="라이선스"
          value={
            <Link href="#open-source" className="text-[#3182F6] hover:underline">
              오픈소스 라이선스
            </Link>
          }
        />
      </Section>

      <Section title="계정">
        <SignOutButton />
        <DeleteAccountButton onError={setError('delete-account')} />
      </Section>

      {mutationError ? (
        <div className="rounded-[16px] border border-[#FECDD3] bg-[#FFECEE] p-4 text-[14px] font-semibold text-[#F04452]">
          {mutationError}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#F7F8FA]">
      {/* < lg : 폰 셸 */}
      <div className="mx-auto min-h-dvh max-w-[430px] bg-white pb-[88px] lg:hidden">
        <header className="flex items-center px-4 pb-3 pt-5">
          <h1 className="text-[20px] font-bold text-[#191F28]">설정</h1>
        </header>
        <div className="px-4 pt-2">
          {loadError ? (
            <div className="mb-3 rounded-[16px] border border-[#FECDD3] bg-[#FFECEE] p-3 text-[13px] font-semibold text-[#F04452]">
              {loadError}
            </div>
          ) : null}
          {content}
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
                  Tripick · 설정
                </div>
                <h1 className="mt-0.5 text-[22px] font-bold leading-[30px] text-[#191F28]">
                  계정 / 알림 / 앱 정보
                </h1>
              </div>
            </div>
          </header>
          <div className="mx-auto w-full max-w-[1160px] px-8 py-6 xl:px-10">{content}</div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 px-1">
        <h2 className="text-[15px] font-bold text-[#191F28]">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-[18px] text-[#8B95A1]">{description}</p>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-[16px] border border-[#E5E8EB] bg-white p-2">
        {children}
      </div>
    </section>
  );
}

function LinkRow({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex h-12 items-center justify-between rounded-[10px] px-3 text-[14px] font-semibold text-[#191F28] hover:bg-[#FAFBFC]"
    >
      <span>{label}</span>
      <span className="text-[12px] text-[#8B95A1]" aria-hidden>
        →
      </span>
    </Link>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex h-12 items-center justify-between rounded-[10px] px-3 text-[14px]">
      <span className="font-semibold text-[#6B7684]">{label}</span>
      <span className="font-semibold text-[#191F28]">{value}</span>
    </div>
  );
}
