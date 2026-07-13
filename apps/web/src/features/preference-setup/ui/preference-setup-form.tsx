'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityIntensity,
  CompanionPreference,
  CrowdPreference,
  InterestPreference,
  TransportPreference,
  TravelPace,
  TravelStylePreference,
} from '@tripick/types';
import {
  ACTIVITY_INTENSITY_OPTIONS,
  COMPANION_OPTIONS,
  CROWD_OPTIONS,
  INSTAGRAM_TAGS,
  INTEREST_OPTIONS,
  PACE_OPTIONS,
  TRANSPORT_OPTIONS,
  TRAVEL_STYLE_OPTIONS,
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
import { TimeField } from '@/shared/ui';

type Notice = {
  title: string;
  description: string;
  tone: 'red' | 'green';
};

export function PreferenceSetupForm() {
  const queryClient = useQueryClient();
  const hydrated = useRef(false);
  const [form, setForm] = useState<PreferenceFormState>(DEFAULT_PREFERENCE_FORM);
  const [hasSession, setHasSession] = useState(() => Boolean(getStoredSession()));
  const [notice, setNotice] = useState<Notice | null>(null);

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
    if (preferenceQuery.error instanceof Error) {
      setNotice({
        title: '불러오기 실패',
        description: preferenceQuery.error.message,
        tone: 'red',
      });
    }
  }, [preferenceQuery.error]);

  const ready =
    form.travelStyles.length > 0 &&
    form.companions.length > 0 &&
    form.transportModes.length > 0 &&
    form.wakeTime < form.sleepTime;

  const savePreferenceMutation = useMutation({
    mutationFn: async (nextForm: PreferenceFormState) => {
      const session = getStoredSession() ?? (await startDemoSession());
      return savePreferences(session.tokens.accessToken, nextForm);
    },
    onSuccess: (preference) => {
      queryClient.setQueryData(queryKeys.preferences.me, preference);
      setHasSession(true);
      setNotice({
        title: '저장 완료',
        description: '취향을 저장했습니다.',
        tone: 'green',
      });
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
        description: '취향, 동행 유형, 이동수단을 하나 이상 고르고 시간을 확인해주세요.',
        tone: 'red',
      });
      return;
    }
    setNotice(null);
    savePreferenceMutation.mutate(form);
  }

  return (
    <div className="space-y-8">
      <SetupBlock title="어떤 여행을 좋아하세요?">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
          {TRAVEL_STYLE_OPTIONS.map((option) => (
            <SegmentedOption
              key={option.value}
              active={form.travelStyles.includes(option.value)}
              label={option.label}
              onClick={() => toggleArray(option.value, 'travelStyles')}
            />
          ))}
        </div>
      </SetupBlock>

      <SetupBlock title="관심 있는 테마를 모두 골라주세요">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {INTEREST_OPTIONS.map((option) => (
            <SegmentedOption
              key={option.value}
              active={form.interests.includes(option.value)}
              label={option.label}
              onClick={() => toggleArray(option.value, 'interests')}
            />
          ))}
        </div>
      </SetupBlock>

      <SetupBlock title="누구와 여행하나요?">
        <div className="grid grid-cols-4 gap-2 lg:max-w-[520px]">
          {COMPANION_OPTIONS.map((option) => (
            <SegmentedOption
              key={option.value}
              active={form.companions.includes(option.value)}
              label={option.label}
              onClick={() => toggleArray(option.value, 'companions')}
            />
          ))}
        </div>
      </SetupBlock>

      <SetupBlock title="취침 / 기상 시간">
        <div className="grid grid-cols-2 gap-3 lg:max-w-[520px]">
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:max-w-[640px]">
          {TRANSPORT_OPTIONS.map((option) => (
            <SegmentedOption
              key={option.value}
              active={form.transportModes.includes(option.value)}
              label={option.label}
              onClick={() => toggleArray(option.value, 'transportModes')}
            />
          ))}
        </div>
      </SetupBlock>

      <SetupBlock title="여행 페이스">
        <div className="grid grid-cols-3 gap-2 lg:max-w-[520px]">
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
        <div className="grid grid-cols-3 gap-2 lg:max-w-[520px]">
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
        <div className="grid grid-cols-3 gap-2 lg:max-w-[520px]">
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
        <div className="mt-3 grid grid-cols-3 gap-2 lg:max-w-[420px]">
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

      {notice ? (
        <InlineNotice title={notice.title} description={notice.description} tone={notice.tone} />
      ) : null}
      <div className="lg:max-w-[360px]">
        <PrimaryButton disabled={savePreferenceMutation.isPending || !ready} onClick={handleSubmit}>
          {savePreferenceMutation.isPending ? '저장 중' : '취향 저장'}
        </PrimaryButton>
      </div>
    </div>
  );

  function toggleArray(
    value: TravelStylePreference | CompanionPreference | TransportPreference | InterestPreference,
    key: 'travelStyles' | 'companions' | 'transportModes' | 'interests',
  ) {
    setForm((current) => {
      const values = current[key] as string[];
      const next = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];
      return { ...current, [key]: next };
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
