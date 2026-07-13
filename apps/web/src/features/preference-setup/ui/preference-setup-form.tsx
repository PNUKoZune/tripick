'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FiImage, FiThumbsDown, FiThumbsUp, FiX } from 'react-icons/fi';
import type { TasteTagDto, ThemePreference, TransportPreference } from '@tripick/types';
import {
  ACTIVITY_INTENSITY_OPTIONS,
  CROWD_OPTIONS,
  PACE_OPTIONS,
  TASTE_TAG_LABELS,
  THEME_GROUPS,
  TRANSPORT_OPTIONS,
} from '@/entities/preferences/model/options';
import {
  analyzePreferenceImages,
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

/** 백엔드 업로드 제약과 동일하게 맞춘다 (FilesInterceptor 10장 · 10MB · jpeg/png/webp). */
const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function PreferenceSetupForm() {
  const queryClient = useQueryClient();
  const hydrated = useRef(false);
  const [form, setForm] = useState<PreferenceFormState>(DEFAULT_PREFERENCE_FORM);
  const [hasSession, setHasSession] = useState(() => Boolean(getStoredSession()));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [analyzedTags, setAnalyzedTags] = useState<TasteTagDto | null>(null);
  // 추가/삭제 후 아직 분석에 반영되지 않은 사진이 있는지
  const [photosDirty, setPhotosDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    // 이미 사진 분석으로 저장된 취향 태그가 있으면 그대로 노출
    const tags = preferenceQuery.data.tasteTags;
    if (tags && tags.food.length + tags.mood.length + tags.environment.length > 0) {
      setAnalyzedTags(tags);
    }
  }, [preferenceQuery.data]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  // 선택한 사진의 미리보기 URL 생성/해제
  useEffect(() => {
    const urls = photos.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [photos]);

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
    form.likedThemes.length > 0 &&
    form.transportModes.length > 0 &&
    form.wakeTime !== form.sleepTime;

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

  const analyzePhotosMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const session = getStoredSession() ?? (await startDemoSession());
      return analyzePreferenceImages(session.tokens.accessToken, files);
    },
    onSuccess: (result) => {
      setHasSession(true);
      setAnalyzedTags(result.tasteTags);
      setPhotosDirty(false);
      // 서버가 취향 태그·임베딩을 upsert 했으므로 캐시를 갱신
      queryClient.invalidateQueries({ queryKey: queryKeys.preferences.me });
      const count =
        result.tasteTags.food.length +
        result.tasteTags.mood.length +
        result.tasteTags.environment.length;
      setNotice(null);
      setToast({
        title: '사진 분석 완료',
        message:
          count > 0
            ? '사진에서 취향을 분석했어요.'
            : '뚜렷한 취향을 찾지 못했어요. 다른 사진을 올려보세요.',
      });
    },
    onError: (error) => {
      setNotice({
        title: '사진 분석 실패',
        description: error instanceof Error ? error.message : '사진 분석에 실패했습니다.',
        tone: 'red',
      });
    },
  });

  function handleSubmit() {
    if (!ready) {
      setNotice({
        title: '확인 필요',
        description:
          '선호 테마와 이동수단을 하나 이상 고르고, 취침·기상 시각을 다르게 설정해주세요.',
        tone: 'red',
      });
      return;
    }
    if (photos.length > 0 && photosDirty) {
      setNotice({
        title: '사진 분석 먼저',
        description: '추가한 사진을 “취향 분석하기”로 먼저 반영한 뒤 저장해주세요.',
        tone: 'red',
      });
      return;
    }
    setNotice(null);
    savePreferenceMutation.mutate(form);
  }

  if (hasSession && preferenceQuery.isLoading) {
    return (
      <div className="space-y-4" aria-hidden>
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-20 animate-pulse rounded-[16px] bg-[color:var(--soft-bg)]"
          />
        ))}
      </div>
    );
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

        <SetupBlock title="사진으로 취향 분석">
          <p className="-mt-1 mb-3 text-[13px] font-medium leading-5 text-[color:var(--text-tertiary)]">
            좋아하는 장소·음식 사진을 올리면 취향을 자동으로 분석해요. (최대 10장)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(event) => {
              addPhotos(event.target.files);
              event.target.value = '';
            }}
          />
          <div className="flex flex-wrap gap-2">
            {previews.map((url, index) => (
              <div key={url} className="relative size-20 overflow-hidden rounded-[12px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  aria-label="사진 제거"
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/55 text-white"
                >
                  <FiX className="size-3" aria-hidden />
                </button>
              </div>
            ))}
            {photos.length < 10 ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex size-20 flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-[#C9CDD2] text-[color:var(--text-tertiary)]"
              >
                <FiImage className="size-5" aria-hidden />
                <span className="text-[11px] font-semibold">사진 추가</span>
              </button>
            ) : null}
          </div>

          {photos.length > 0 ? (
            <button
              type="button"
              onClick={() => analyzePhotosMutation.mutate(photos)}
              disabled={analyzePhotosMutation.isPending}
              className="mt-3 h-11 w-full rounded-[14px] bg-[color:var(--blue-50)] text-[14px] font-bold text-[color:var(--blue-700)] transition active:scale-[0.99] disabled:text-[color:var(--text-tertiary)] lg:max-w-[280px]"
            >
              {analyzePhotosMutation.isPending
                ? '분석 중…'
                : `사진 ${photos.length}장으로 취향 분석하기`}
            </button>
          ) : null}

          {analyzedTags ? (
            <div className="mt-3">
              <div className="text-[12px] font-semibold text-[#8B95A1]">분석된 취향 태그</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[...analyzedTags.food, ...analyzedTags.mood, ...analyzedTags.environment].map(
                  (tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-[color:var(--blue-50)] px-3 py-1 text-[13px] font-bold text-[color:var(--blue-700)]"
                    >
                      {TASTE_TAG_LABELS[tag] ?? tag}
                    </span>
                  ),
                )}
                {analyzedTags.food.length +
                  analyzedTags.mood.length +
                  analyzedTags.environment.length ===
                0 ? (
                  <span className="text-[13px] font-medium text-[color:var(--text-tertiary)]">
                    뚜렷한 취향을 찾지 못했어요.
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
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
      <div className="border-t border-[color:var(--line)] pt-6">
        <div className="lg:mx-auto lg:max-w-[420px]">
          <PrimaryButton
            disabled={savePreferenceMutation.isPending || !ready}
            onClick={handleSubmit}
          >
            {savePreferenceMutation.isPending ? '저장 중' : '취향 저장'}
          </PrimaryButton>
        </div>
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

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    const valid = incoming.filter(
      (file) => ACCEPTED_PHOTO_TYPES.includes(file.type) && file.size <= MAX_PHOTO_BYTES,
    );
    if (valid.length < incoming.length) {
      setNotice({
        title: '일부 사진 제외',
        description: 'JPG·PNG·WEBP 형식의 10MB 이하 사진만 올릴 수 있어요.',
        tone: 'red',
      });
    }
    if (valid.length === 0) return;
    // 서버 업로드 한도(10장)에 맞춰 자른다.
    setPhotos((current) => [...current, ...valid].slice(0, MAX_PHOTOS));
    setPhotosDirty(true);
  }

  function removePhoto(index: number) {
    setPhotos((current) => current.filter((_, item) => item !== index));
    setPhotosDirty(true);
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
