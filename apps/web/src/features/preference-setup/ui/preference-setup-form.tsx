'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FiThumbsDown, FiThumbsUp } from 'react-icons/fi';
import type { ThemePreference, TransportPreference } from '@tripick/types';
import {
  ACTIVITY_INTENSITY_OPTIONS,
  CROWD_OPTIONS,
  INSTAGRAM_TAGS,
  PACE_OPTIONS,
  THEME_GROUPS,
  TRANSPORT_OPTIONS,
} from '@/entities/preferences/model/options';
import {
  DEFAULT_PREFERENCE_FORM,
  getMyPreferences,
  savePreferences,
  type PreferenceFormState,
} from '@/entities/preferences/api/preferences-api';
import { getStoredSession } from '@/entities/session/model/session-storage';
import { startDemoSession } from '@/entities/session/api/auth-api';
import { queryKeys } from '@/shared/api/query-keys';
import { InlineNotice, PrimaryButton, SegmentedOption } from '@/shared/ui/app-frame';
import { TimeField, Toast } from '@/shared/ui';

type Notice = {
  title: string;
  description: string;
  tone: 'red' | 'green';
};

type ThemeStance = 'like' | 'dislike';

export function PreferenceSetupForm() {
  const queryClient = useQueryClient();
  const hydrated = useRef(false);
  const [form, setForm] = useState<PreferenceFormState>(DEFAULT_PREFERENCE_FORM);
  const [hasSession, setHasSession] = useState(() => Boolean(getStoredSession()));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);

  const preferenceQuery = useQuery({
    queryKey: queryKeys.preferences.me,
    queryFn: async () => {
      const session = getStoredSession();
      if (!session) {
        return null;
      }
      return getMyPreferences(session.tokens.accessToken);
    },
    enabled: hasSession,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!preferenceQuery.data?.profile || hydrated.current) {
      return;
    }
    hydrated.current = true;
    setForm({ ...DEFAULT_PREFERENCE_FORM, ...preferenceQuery.data.profile });
  }, [preferenceQuery.data]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (preferenceQuery.error instanceof Error) {
      setNotice({
        title: '불러오기 실패',
        description: preferenceQuery.error.message,
        tone: 'red',
      });
    }
  }, [preferenceQuery.error]);

  const ready =
    form.likedThemes.length > 0 && form.transportModes.length > 0 && form.wakeTime < form.sleepTime;

  const savePreferenceMutation = useMutation({
    mutationFn: async (nextForm: PreferenceFormState) => {
      const session = getStoredSession() ?? (await startDemoSession());
      return savePreferences(session.tokens.accessToken, nextForm);
    },
    onSuccess: (preference) => {
      queryClient.setQueryData(queryKeys.preferences.me, preference);
      setHasSession(true);
      setNotice(null);
      setToast({ title: '저장 완료', message: '취향을 저장했습니다.' });
    },
    onError: (error) => {
      setNotice({
        title: '저장 실패',
        description: error instanceof Error ? error.message : '취향 저장에 실패했습니다.',
        tone: 'red',
      });
    },
  });

  function handleSubmit() {
    if (!ready) {
      setNotice({
        title: '확인 필요',
        description: '선호 테마와 이동수단을 하나 이상 고르고 시간을 확인해주세요.',
        tone: 'red',
      });
      return;
    }
    setNotice(null);
    savePreferenceMutation.mutate(form);
  }

  return (
    <div className="space-y-8">
      <SetupBlock title="테마/장소 선호도">
        <p className="-mt-1 mb-3 text-[13px] font-medium leading-5 text-[color:var(--text-tertiary)]">
          좋아하는 건 선호, 피하고 싶은 건 불호로 골라주세요. 고르지 않으면 중립이에요.
        </p>
        <div className="space-y-4">
          {THEME_GROUPS.map((group) => (
            <div key={group.key}>
              <h3 className="mb-1.5 text-[13px] font-bold leading-5 text-[color:var(--text-secondary)]">
                {group.label}
              </h3>
              <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
                {group.themes.map((theme) => (
                  <ThemeStanceRow
                    key={theme.value}
                    label={theme.label}
                    examples={theme.examples}
                    stance={themeStance(theme.value)}
                    onSelect={(stance) => setThemeStance(theme.value, stance)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </SetupBlock>

      <div className="grid gap-x-8 gap-y-8 lg:grid-cols-2">
        <SetupBlock title="취침 / 기상 시간">
          <div className="grid grid-cols-2 gap-3">
          <TimeField
            variant="soft"
            label="취침"
            value={form.sleepTime}
            onChange={(sleepTime) => setForm((current) => ({ ...current, sleepTime }))}
          />
          <TimeField
            variant="soft"
            label="기상"
            value={form.wakeTime}
            onChange={(wakeTime) => setForm((current) => ({ ...current, wakeTime }))}
          />
        </div>
      </SetupBlock>

      <SetupBlock title="선호 이동 수단">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TRANSPORT_OPTIONS.map((option) => (
            <SegmentedOption
              key={option.value}
              active={form.transportModes.includes(option.value)}
              label={option.label}
              onClick={() => toggleTransport(option.value)}
            />
          ))}
        </div>
      </SetupBlock>

      <SetupBlock title="여행 페이스">
        <div className="grid grid-cols-3 gap-2">
          {PACE_OPTIONS.map((option) => (
            <ChoiceCard
              key={option.value}
              active={form.pace === option.value}
              label={option.label}
              hint={option.hint}
              onClick={() => setSingle('pace', option.value)}
            />
          ))}
        </div>
      </SetupBlock>

      <SetupBlock title="활동 강도">
        <div className="grid grid-cols-3 gap-2">
          {ACTIVITY_INTENSITY_OPTIONS.map((option) => (
            <ChoiceCard
              key={option.value}
              active={form.activityIntensity === option.value}
              label={option.label}
              hint={option.hint}
              onClick={() => setSingle('activityIntensity', option.value)}
            />
          ))}
        </div>
      </SetupBlock>

      <SetupBlock title="어떤 분위기를 선호하세요?">
        <div className="grid grid-cols-3 gap-2">
          {CROWD_OPTIONS.map((option) => (
            <ChoiceCard
              key={option.value}
              active={form.crowdPreference === option.value}
              label={option.label}
              hint={option.hint}
              onClick={() => setSingle('crowdPreference', option.value)}
            />
          ))}
        </div>
      </SetupBlock>

      <SetupBlock title="Instagram 사진 취향">
        <div className="flex items-center justify-between gap-4 border-y border-[color:var(--line)] py-4">
          <div>
            <div className="text-[15px] font-bold leading-5">연결 준비 중</div>
            <div className="mt-1 text-[13px] font-medium leading-5 text-[color:var(--text-tertiary)]">
              지금은 선택한 태그만 저장돼요.
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              setForm((current) => ({
                ...current,
                instagramConnected: !current.instagramConnected,
              }))
            }
            className={`h-8 w-14 rounded-full p-1 transition ${
              form.instagramConnected ? 'bg-[color:var(--blue-600)]' : 'bg-slate-300'
            }`}
            aria-label="Instagram 연결 상태 전환"
          >
            <span
              className={`block size-6 rounded-full bg-white transition ${
                form.instagramConnected ? 'translate-x-6' : ''
              }`}
            />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {INSTAGRAM_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  instagramTags: current.instagramTags.includes(tag)
                    ? current.instagramTags.filter((item) => item !== tag)
                    : [...current.instagramTags, tag],
                }))
              }
              className={`h-10 rounded-full px-4 text-[13px] font-bold ${
                form.instagramTags.includes(tag)
                  ? 'bg-[color:var(--blue-50)] text-[color:var(--blue-700)]'
                  : 'bg-[color:var(--soft-bg)] text-[color:var(--text-tertiary)]'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
        </SetupBlock>
      </div>

      {notice ? (
        <InlineNotice title={notice.title} description={notice.description} tone={notice.tone} />
      ) : null}
      {toast ? (
        <Toast
          title={toast.title}
          message={toast.message}
          tone="success"
          onClose={() => setToast(null)}
        />
      ) : null}
      <div className="lg:max-w-[360px]">
        <PrimaryButton disabled={savePreferenceMutation.isPending || !ready} onClick={handleSubmit}>
          {savePreferenceMutation.isPending ? '저장 중' : '취향 저장'}
        </PrimaryButton>
      </div>
    </div>
  );

  function toggleTransport(value: TransportPreference) {
    setForm((current) => ({
      ...current,
      transportModes: current.transportModes.includes(value)
        ? current.transportModes.filter((item) => item !== value)
        : [...current.transportModes, value],
    }));
  }

  function themeStance(value: ThemePreference): ThemeStance | null {
    if (form.likedThemes.includes(value)) return 'like';
    if (form.dislikedThemes.includes(value)) return 'dislike';
    return null;
  }

  function setThemeStance(value: ThemePreference, stance: ThemeStance) {
    setForm((current) => {
      const liked = current.likedThemes.filter((item) => item !== value);
      const disliked = current.dislikedThemes.filter((item) => item !== value);
      // 같은 값을 다시 누르면 중립으로 해제, 다른 값이면 해당 진영으로 이동.
      if (themeStance(value) === stance) {
        return { ...current, likedThemes: liked, dislikedThemes: disliked };
      }
      return stance === 'like'
        ? { ...current, likedThemes: [...liked, value], dislikedThemes: disliked }
        : { ...current, likedThemes: liked, dislikedThemes: [...disliked, value] };
    });
  }

  function setSingle<K extends 'pace' | 'activityIntensity' | 'crowdPreference'>(
    key: K,
    value: PreferenceFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }
}

function ChoiceCard({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-0.5 rounded-[16px] px-3 py-3 text-center transition ${
        active
          ? 'bg-[color:var(--blue-50)] text-[color:var(--blue-700)] ring-2 ring-[color:var(--blue-600)]'
          : 'bg-[color:var(--soft-bg)] text-[color:var(--text-tertiary)]'
      }`}
    >
      <span className="text-[14px] font-bold leading-5">{label}</span>
      {hint ? <span className="text-[11px] font-medium leading-4 opacity-70">{hint}</span> : null}
    </button>
  );
}

function SetupBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[color:var(--line)] pt-6 first:border-t-0 first:pt-0">
      <h2 className="mb-3 text-[18px] font-black leading-6">{title}</h2>
      {children}
    </section>
  );
}

function ThemeStanceRow({
  label,
  examples,
  stance,
  onSelect,
}: {
  label: string;
  examples: string[];
  stance: ThemeStance | null;
  onSelect: (stance: ThemeStance) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[12px] bg-[color:var(--soft-bg)] px-3 py-1.5">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-[14px] font-bold leading-6 text-[#191F28]">{label}</span>
        <span className="truncate text-[11px] font-medium text-[color:var(--text-tertiary)]">
          {examples.join(' · ')}
        </span>
      </div>
      <div className="flex shrink-0 gap-1">
        <StanceButton tone="like" active={stance === 'like'} onClick={() => onSelect('like')} />
        <StanceButton
          tone="dislike"
          active={stance === 'dislike'}
          onClick={() => onSelect('dislike')}
        />
      </div>
    </div>
  );
}

function StanceButton({
  tone,
  active,
  onClick,
}: {
  tone: ThemeStance;
  active: boolean;
  onClick: () => void;
}) {
  const like = tone === 'like';
  const label = like ? '선호' : '불호';
  const activeClass = like ? 'bg-[color:var(--blue-600)] text-white' : 'bg-[#F04452] text-white';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`flex size-7 items-center justify-center rounded-full transition ${
        active ? activeClass : 'bg-white text-[color:var(--text-tertiary)]'
      }`}
    >
      {like ? (
        <FiThumbsUp className="size-3.5" aria-hidden />
      ) : (
        <FiThumbsDown className="size-3.5" aria-hidden />
      )}
    </button>
  );
}
