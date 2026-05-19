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

type Notice = {
  title: string;
  description: string;
  tone: 'red' | 'green';
};

export function PreferenceSetupForm() {
  const router = useRouter();
  const [form, setForm] = useState<PreferenceFormState>(DEFAULT_PREFERENCE_FORM);
  const [hasSavedPreference, setHasSavedPreference] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;
    const session = getStoredSession();
    if (!session) {
      return () => {
        cancelled = true;
      };
    }
    void getMyPreferences(session.tokens.accessToken)
      .then((preference) => {
        if (cancelled) {
          return;
        }
        if (preference?.profile) {
          setForm({ ...DEFAULT_PREFERENCE_FORM, ...preference.profile });
          setHasSavedPreference(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotice({
            title: '불러오기 실패',
            description: '저장된 취향을 불러오지 못했습니다.',
            tone: 'red',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready =
    form.travelStyles.length > 0 &&
    form.companions.length > 0 &&
    form.transportModes.length > 0 &&
    form.wakeTime < form.sleepTime;

  async function handleSubmit() {
    if (!ready) {
      setNotice({
        title: '확인 필요',
        description: '취향, 동행 유형, 이동수단을 하나 이상 고르고 시간을 확인해주세요.',
        tone: 'red',
      });
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const session = getStoredSession() ?? (await startDemoSession());
      const shouldStayAfterSave = hasSavedPreference;
      await savePreferences(session.tokens.accessToken, form);
      await ensureActiveTrip(session.tokens.accessToken);
      setHasSavedPreference(true);
      if (shouldStayAfterSave) {
        setNotice({
          title: '저장 완료',
          description: '취향을 저장했습니다.',
          tone: 'green',
        });
        return;
      }
      router.push('/members');
    } catch (error) {
      setNotice({
        title: '저장 실패',
        description: error instanceof Error ? error.message : '취향 저장에 실패했습니다.',
        tone: 'red',
      });
    } finally {
      setLoading(false);
    }
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
        <PrimaryButton disabled={loading || !ready} onClick={handleSubmit}>
          {loading ? '저장 중' : hasSavedPreference ? '취향 저장' : '취향 저장하고 멤버 추가'}
        </PrimaryButton>
      </div>
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
