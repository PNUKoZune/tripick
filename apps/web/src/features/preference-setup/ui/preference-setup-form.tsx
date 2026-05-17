'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  CompanionPreference,
  TransportPreference,
  TravelStylePreference,
} from '@tripick/types';
import {
  COMPANION_OPTIONS,
  INSTAGRAM_TAGS,
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
import { ensureActiveTrip } from '@/entities/trip/api/trip-api';
import { InlineNotice, PrimaryButton, SegmentedOption } from '@/shared/ui/app-frame';

export function PreferenceSetupForm() {
  const router = useRouter();
  const [form, setForm] = useState<PreferenceFormState>(DEFAULT_PREFERENCE_FORM);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const session = getStoredSession();
    if (!session) {
      return;
    }
    void getMyPreferences(session.tokens.accessToken).then((preference) => {
      if (preference?.profile) {
        setForm({ ...DEFAULT_PREFERENCE_FORM, ...preference.profile });
      }
    });
  }, []);

  const ready =
    form.travelStyles.length > 0 &&
    form.companions.length > 0 &&
    form.transportModes.length > 0 &&
    form.wakeTime < form.sleepTime;

  async function handleSubmit() {
    if (!ready) {
      setMessage('취향, 동행 유형, 이동수단을 하나 이상 고르고 시간을 확인해주세요.');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const session = getStoredSession() ?? (await startDemoSession());
      await savePreferences(session.tokens.accessToken, form);
      await ensureActiveTrip(session.tokens.accessToken);
      router.push('/members');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '취향 저장에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <SetupBlock title="어떤 여행을 좋아하세요?">
        <div className="grid grid-cols-2 gap-2.5">
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

      <SetupBlock title="누구와 여행하나요?">
        <div className="grid grid-cols-4 gap-2">
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
        <div className="grid grid-cols-2 gap-3">
          <TimeField
            label="취침"
            value={form.sleepTime}
            onChange={(sleepTime) => setForm((current) => ({ ...current, sleepTime }))}
          />
          <TimeField
            label="기상"
            value={form.wakeTime}
            onChange={(wakeTime) => setForm((current) => ({ ...current, wakeTime }))}
          />
        </div>
      </SetupBlock>

      <SetupBlock title="선호 이동 수단">
        <div className="grid grid-cols-4 gap-2">
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

      <SetupBlock title="Instagram 사진 취향">
        <div className="flex items-center justify-between gap-4 border-y border-[color:var(--line)] py-4">
          <div>
            <div className="text-[15px] font-bold leading-5">사진 분석 준비</div>
            <div className="mt-1 text-[13px] font-medium leading-5 text-[color:var(--text-tertiary)]">
              API 연결 전에는 태그만 저장
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

      {message ? <InlineNotice title="확인 필요" description={message} tone="red" /> : null}
      <PrimaryButton disabled={loading || !ready} onClick={handleSubmit}>
        {loading ? '저장 중' : '취향 저장하고 멤버 추가'}
      </PrimaryButton>
    </div>
  );

  function toggleArray(
    value: TravelStylePreference | CompanionPreference | TransportPreference,
    key: 'travelStyles' | 'companions' | 'transportModes',
  ) {
    setForm((current) => {
      const values = current[key] as string[];
      const next = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];
      return { ...current, [key]: next };
    });
  }
}

function SetupBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[color:var(--line)] pt-6 first:border-t-0 first:pt-0">
      <h2 className="mb-3 text-[18px] font-black leading-6">{title}</h2>
      {children}
    </section>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block rounded-[16px] bg-[color:var(--soft-bg)] px-4 py-3">
      <span className="block text-[13px] font-bold text-[color:var(--text-tertiary)]">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-8 w-full bg-transparent text-[20px] font-black leading-7 outline-none"
      />
    </label>
  );
}
