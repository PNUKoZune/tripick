'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LuChevronRight } from 'react-icons/lu';
import { useQuery } from '@tanstack/react-query';

import { SessionGuard } from '@/entities/session';
import { fetchMe } from '@/entities/user';
import { DeleteAccountButton } from '@/features/delete-account';
import { SignOutButton } from '@/features/sign-out';
import { NotificationPreferencesList } from '@/features/update-notification-preferences';
import { queryKeys } from '@/shared/api/query-keys';
import { firstErrorMessage } from '@/shared/lib';
import { AppFrame, PageContainer, PageHeader } from '@/shared/ui/app-frame';
import { SettingsProfileHero } from '@/widgets/settings-profile-hero';

// next.config 가 package.json version 을 주입한다(단일 출처). 빌드 시 인라인.
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';

export function SettingsView() {
  return (
    <SessionGuard>
      <SettingsContent />
    </SessionGuard>
  );
}

function SettingsContent() {
  const {
    data: me,
    error,
    isLoading,
  } = useQuery({
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

  return (
    <AppFrame themed>
      <PageHeader title="설정" label="설정" description="계정·알림·앱 정보를 관리합니다." />
      <PageContainer>
        {loadError ? (
          <div
            role="alert"
            className="mb-4 rounded-[16px] border border-[color:var(--danger-border)] bg-[color:var(--danger-tint)] p-3 text-[13px] font-semibold text-[color:var(--danger)]"
          >
            {loadError}
          </div>
        ) : null}

        <div className="space-y-6">
          <section>
            <div className="mb-2 px-1">
              <h2 className="text-[15px] font-bold text-[color:var(--ink)]">프로필</h2>
              <p className="mt-0.5 text-[12px] leading-[18px] text-[color:var(--ink-faint)]">
                다른 멤버와 친구에게 보이는 정보예요.
              </p>
            </div>
            <SettingsProfileHero me={me} loading={isLoading} onError={setError('profile')} />
          </section>

          <Section
            title="알림 설정"
            description="끄면 인박스와 푸시 모두 받지 않아요. 친구 요청은 친구 페이지에선 계속 보여요."
          >
            <NotificationPreferencesList me={me} onError={setError('notifications')} />
          </Section>

          <Section title="약관 및 정책">
            <LinkRow href="/legal/terms" label="이용약관" />
            <LinkRow href="/legal/privacy" label="개인정보처리방침" />
            <LinkRow href="/support" label="고객센터" />
          </Section>

          <Section title="앱 정보">
            <InfoRow label="버전" value={APP_VERSION} />
            <InfoRow
              label="라이선스"
              value={
                <Link href="#open-source" className="text-[color:var(--primary)] hover:underline">
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
            <div
              role="alert"
              className="rounded-[16px] border border-[color:var(--danger-border)] bg-[color:var(--danger-tint)] p-4 text-[14px] font-semibold text-[color:var(--danger)]"
            >
              {mutationError}
            </div>
          ) : null}
        </div>
      </PageContainer>
    </AppFrame>
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
        <h2 className="text-[15px] font-bold text-[color:var(--ink)]">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-[18px] text-[color:var(--ink-faint)]">
            {description}
          </p>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card)] p-2">
        {children}
      </div>
    </section>
  );
}

function LinkRow({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex h-12 items-center justify-between rounded-[10px] px-3 text-[14px] font-semibold text-[color:var(--ink)] hover:bg-[color:var(--card-soft)]"
    >
      <span>{label}</span>
      <LuChevronRight className="size-4 text-[color:var(--ink-faint)]" aria-hidden />
    </Link>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex h-12 items-center justify-between rounded-[10px] px-3 text-[14px]">
      <span className="font-semibold text-[color:var(--ink-sub)]">{label}</span>
      <span className="font-semibold text-[color:var(--ink)]">{value}</span>
    </div>
  );
}
