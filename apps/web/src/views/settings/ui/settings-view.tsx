'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LuChevronRight } from 'react-icons/lu';
import { useQuery } from '@tanstack/react-query';

import { SessionGuard } from '@/entities/session';
import { fetchMe } from '@/entities/user';
import { DeleteAccountButton } from '@/features/delete-account';
import { SignOutButton } from '@/features/sign-out';
import { ThemeSwitch } from '@/features/switch-theme';
import { NotificationPreferencesList } from '@/features/update-notification-preferences';
import { queryKeys } from '@/shared/api/query-keys';
import { firstErrorMessage } from '@/shared/lib';
import { useNativeAppVersion } from '@/shared/rn-bridge/native-app-version';
import { AppFrame, PageContainer, PageHeader } from '@/shared/ui/app-frame';
import { SettingsProfileHero } from '@/widgets/settings-profile-hero';

export function SettingsView() {
  return (
    <SessionGuard>
      <SettingsContent />
    </SessionGuard>
  );
}

function SettingsContent() {
  const nativeAppVersion = useNativeAppVersion();
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
                다른 멤버와 친구에게 보이는 정보예요. 이름·아이디는 눌러서 바꿀 수 있어요.
              </p>
            </div>
            <SettingsProfileHero me={me} loading={isLoading} onError={setError('profile')} />
          </section>

          {/* 설명은 목록 첫 줄의 "모든 알림" 행이 직접 달고 있다 — 같은 문장을 섹션 헤더에도
              두면 두 줄이 겹쳐 읽힌다. */}
          <Section title="알림 설정">
            <NotificationPreferencesList me={me} onError={setError('notifications')} />
          </Section>

          <Section
            title="화면 테마"
            description="시스템 설정을 따르거나 밝기를 직접 고를 수 있어요."
          >
            <div className="p-1">
              <ThemeSwitch />
            </div>
          </Section>

          <Section title="약관 및 정책">
            <LinkRow href="/legal/terms" label="이용약관" />
            <LinkRow href="/legal/privacy" label="개인정보처리방침" />
            <LinkRow href="/support" label="고객센터" />
          </Section>

          <Section title="앱 정보">
            {/* 버전은 앱에서만 — 셸이 알려 준 스토어 버전. 브라우저는 push 마다 재배포돼
                올릴 사람이 없는 package.json 숫자가 굳어 보일 뿐이라 행 자체를 감춘다. */}
            {nativeAppVersion ? <InfoRow label="버전" value={nativeAppVersion} /> : null}
            {/* 링크 대신 값만 — 레포 LICENSE 가 MIT 이고, 별도 고지 페이지가 없다. */}
            <InfoRow label="라이선스" value="MIT" />
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
      className="flex h-12 items-center justify-between rounded-[12px] px-3 text-[14px] font-semibold text-[color:var(--ink)] hover:bg-[color:var(--card-soft)]"
    >
      <span>{label}</span>
      <LuChevronRight className="size-4 text-[color:var(--ink-faint)]" aria-hidden />
    </Link>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex h-12 items-center justify-between rounded-[12px] px-3 text-[14px]">
      <span className="font-semibold text-[color:var(--ink-sub)]">{label}</span>
      <span className="font-semibold text-[color:var(--ink)]">{value}</span>
    </div>
  );
}
