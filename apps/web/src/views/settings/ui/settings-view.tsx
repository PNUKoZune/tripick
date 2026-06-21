'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationPreferenceKey } from '@tripick/types';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  deleteMe,
  fetchMe,
  updateMe,
  updateNotificationPreferences,
} from '@/entities/user';
import { logout } from '@/entities/session/api/auth-api';
import { queryKeys } from '@/shared/api/query-keys';
import { AppBottomNavigation, AppDesktopNavigation } from '@/shared/ui/app-frame';

const NOTIFICATION_ROWS: Array<{
  key: NotificationPreferenceKey;
  label: string;
  description: string;
}> = [
  {
    key: 'trip_invite',
    label: '여행 초대',
    description: '친구가 여행에 초대했을 때 알려줘요.',
  },
  {
    key: 'friend_request',
    label: '친구 요청',
    description: '새로운 친구 요청이 도착했을 때 알려줘요.',
  },
  {
    key: 'replan_ready',
    label: '재계획 / 날씨 변동',
    description: '대안 일정 반영이 끝나거나 날씨가 크게 바뀌면 알려줘요.',
  },
  {
    key: 'trip_reminder',
    label: '여행 임박 리마인더',
    description: '출발 하루 전에 챙길 것을 정리해 알려줘요.',
  },
  {
    key: 'general',
    label: '일반 알림',
    description: '서비스 안내나 이벤트 소식을 알려줘요.',
  },
];

export function SettingsView() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: me, error } = useQuery({
    queryKey: queryKeys.user.me,
    queryFn: fetchMe,
    staleTime: 60 * 1000,
  });
  const loadError = error instanceof Error ? error.message : null;

  const [nicknameDraft, setNicknameDraft] = useState('');
  const [editingNickname, setEditingNickname] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);

  useEffect(() => {
    if (me) setNicknameDraft(me.nickname);
  }, [me]);

  const invalidateMe = () => queryClient.invalidateQueries({ queryKey: queryKeys.user.me });

  const nicknameMutation = useMutation({
    mutationFn: (nickname: string) => updateMe({ nickname }),
    onSuccess: () => {
      invalidateMe();
      setEditingNickname(false);
    },
  });

  const prefsMutation = useMutation({
    mutationFn: (preferences: Partial<Record<NotificationPreferenceKey, boolean>>) =>
      updateNotificationPreferences({ preferences }),
    onSuccess: () => invalidateMe(),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMe,
    onSuccess: async () => {
      await logout();
      queryClient.clear();
      router.replace('/start');
    },
  });

  const merged = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(me?.notificationPreferences ?? {}),
  };

  async function handleSignOut() {
    setSignOutPending(true);
    try {
      await logout();
      queryClient.clear();
      router.replace('/start');
    } finally {
      setSignOutPending(false);
    }
  }

  const mutationError =
    nicknameMutation.error instanceof Error
      ? nicknameMutation.error.message
      : prefsMutation.error instanceof Error
        ? prefsMutation.error.message
        : deleteMutation.error instanceof Error
          ? deleteMutation.error.message
          : null;

  const content = (
    <div className="space-y-6">
      {/* 프로필 */}
      <Section title="프로필" description="다른 멤버와 친구에게 보이는 정보예요.">
        <div className="flex items-center gap-4 px-1">
          <div
            aria-hidden
            className="flex size-14 items-center justify-center overflow-hidden rounded-full bg-[#EAF2FF] text-[18px] font-bold text-[#1B64DA]"
          >
            {me?.profileImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.profileImageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              me?.nickname?.slice(0, 1) ?? '?'
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {editingNickname ? (
                <input
                  type="text"
                  value={nicknameDraft}
                  onChange={(event) => setNicknameDraft(event.target.value)}
                  maxLength={20}
                  className="h-10 flex-1 rounded-[10px] border border-[#3182F6] bg-white px-3 text-[15px] font-bold text-[#191F28] outline-none ring-2 ring-[#E1ECFF]"
                />
              ) : (
                <span className="truncate text-[16px] font-bold text-[#191F28]">
                  {me?.nickname ?? '—'}
                </span>
              )}
              {editingNickname ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => nicknameMutation.mutate(nicknameDraft.trim())}
                    disabled={
                      nicknameMutation.isPending ||
                      !nicknameDraft.trim() ||
                      nicknameDraft.trim() === me?.nickname
                    }
                    className="h-9 rounded-[10px] bg-[#3182F6] px-3 text-[12px] font-bold text-white hover:bg-[#1B64DA] disabled:opacity-50"
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingNickname(false);
                      if (me) setNicknameDraft(me.nickname);
                    }}
                    className="h-9 rounded-[10px] border border-[#E5E8EB] px-3 text-[12px] font-bold text-[#6B7684] hover:bg-[#FAFBFC]"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingNickname(true)}
                  disabled={!me}
                  className="h-9 rounded-[10px] border border-[#E5E8EB] px-3 text-[12px] font-bold text-[#6B7684] hover:bg-[#FAFBFC] disabled:opacity-50"
                >
                  편집
                </button>
              )}
            </div>
            <div className="mt-1 truncate text-[12px] text-[#8B95A1]">
              {me?.email ?? me?.kakaoId ? `@${me?.kakaoId}` : '카카오 ID 연동 안 됨'}
              {me?.isDemo ? (
                <span className="ml-1.5 rounded-full bg-[#FFF4E6] px-1.5 py-0.5 text-[10px] font-semibold text-[#FF8A00]">
                  데모 계정
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Section>

      {/* 알림 설정 */}
      <Section
        title="알림 설정"
        description="끄면 인박스와 푸시 모두 받지 않아요. 친구 요청은 친구 페이지에선 계속 보여요."
      >
        <div className="divide-y divide-[#F2F4F6]">
          {NOTIFICATION_ROWS.map((row) => {
            const enabled = merged[row.key];
            return (
              <div key={row.key} className="flex items-start gap-3 px-1 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-bold text-[#191F28]">{row.label}</div>
                  <p className="mt-0.5 text-[12px] leading-[18px] text-[#6B7684]">
                    {row.description}
                  </p>
                </div>
                <Switch
                  checked={enabled}
                  disabled={prefsMutation.isPending}
                  onChange={(next) =>
                    prefsMutation.mutate({ [row.key]: next } as Partial<
                      Record<NotificationPreferenceKey, boolean>
                    >)
                  }
                  aria-label={`${row.label} 알림 ${enabled ? '끄기' : '켜기'}`}
                />
              </div>
            );
          })}
        </div>
      </Section>

      {/* 약관 / 정책 */}
      <Section title="약관 및 정책">
        <LinkRow href="#terms" label="이용약관" />
        <LinkRow href="#privacy" label="개인정보처리방침" />
        <LinkRow href="#contact" label="고객센터" />
      </Section>

      {/* 앱 정보 */}
      <Section title="앱 정보">
        <InfoRow label="버전" value={APP_VERSION} />
        <InfoRow
          label="라이선스"
          value={
            <Link
              href="#open-source"
              className="text-[#3182F6] hover:underline"
            >
              오픈소스 라이선스
            </Link>
          }
        />
      </Section>

      {/* 계정 */}
      <Section title="계정">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signOutPending}
          className="flex h-12 w-full items-center justify-between rounded-[12px] border border-[#E5E8EB] bg-white px-4 text-left text-[14px] font-bold text-[#191F28] hover:bg-[#FAFBFC] disabled:opacity-50"
        >
          <span>로그아웃</span>
          <span className="text-[12px] text-[#8B95A1]">{signOutPending ? '진행 중…' : '→'}</span>
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="mt-2 flex h-12 w-full items-center justify-between rounded-[12px] border border-[#FECDD3] bg-white px-4 text-left text-[14px] font-bold text-[#F04452] hover:bg-[#FFECEE]"
        >
          <span>회원 탈퇴</span>
          <span className="text-[12px]">→</span>
        </button>
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
            <div className="mx-auto flex w-full max-w-[760px] items-center justify-between gap-6 px-8 py-4 xl:px-10">
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
          <div className="mx-auto w-full max-w-[760px] px-8 py-6 xl:px-10">{content}</div>
        </div>
      </div>

      {confirmDelete ? (
        <ConfirmDeleteDialog
          pending={deleteMutation.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => deleteMutation.mutate()}
        />
      ) : null}
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

function Switch({
  checked,
  disabled,
  onChange,
  ...rest
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
} & React.AriaAttributes) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
        checked ? 'bg-[#3182F6]' : 'bg-[#E5E8EB]'
      }`}
      {...rest}
    >
      <span
        aria-hidden
        className={`inline-block size-5 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
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

function ConfirmDeleteDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-5"
    >
      <div className="w-full max-w-[400px] rounded-[20px] bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
        <h2 className="text-[18px] font-bold text-[#191F28]">정말 탈퇴할까요?</h2>
        <p className="mt-2 text-[13px] leading-[20px] text-[#4E5968]">
          여행 일정, 친구 목록, 받은 알림이 모두 삭제됩니다. 이 작업은 되돌릴 수 없어요.
        </p>
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-11 flex-1 rounded-[12px] border border-[#E5E8EB] bg-white text-[14px] font-bold text-[#6B7684] hover:bg-[#FAFBFC] disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="h-11 flex-1 rounded-[12px] bg-[#F04452] text-[14px] font-bold text-white hover:bg-[#D93645] disabled:opacity-50"
          >
            {pending ? '처리 중…' : '탈퇴하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

const APP_VERSION = '0.1.0';
