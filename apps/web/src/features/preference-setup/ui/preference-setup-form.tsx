'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FiCheck,
  FiImage,
  FiLoader,
  FiPlus,
  FiThumbsDown,
  FiThumbsUp,
  FiX,
} from 'react-icons/fi';
import {
  MAX_PREFERENCE_PHOTOS,
  MAX_PREFERENCE_UPLOAD,
  type PreferenceAnalysisJobDto,
  type TasteTagDto,
  type TasteTagValue,
  type ThemePreference,
  type TransportPreference,
} from '@tripick/types';
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
  deletePreferencePhoto,
  forgetAnalysisJob,
  getMyPreferences,
  getPreferenceAnalysisJob,
  getPreferencePhotoTags,
  readAnalysisJob,
  rememberAnalysisJob,
  savePreferences,
  togglePreferencePhotoTag,
  type PreferenceFormState,
} from '@/entities/preferences/api/preferences-api';
import { getStoredSession } from '@/entities/session/model/session-storage';
import { startDemoSession } from '@/entities/session/api/auth-api';
import { queryKeys } from '@/shared/api/query-keys';
import { InlineNotice, SegmentedOption } from '@/shared/ui/app-frame';
import { ConfirmDialog, TimeField, Toast } from '@/shared/ui';

type Notice = {
  title: string;
  description: string;
  tone: 'red' | 'green';
};

type ThemeStance = 'like' | 'dislike';

/** 백엔드 업로드 제약과 동일하게 맞춘다 (한 번에 3장 · 총 10장 · 10MB · jpeg/png/webp). */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** 분석 잡 상태를 다시 물어보는 간격. 사진 1장에 30초 넘게 걸려 촘촘히 볼 이유가 없다. */
const JOB_POLL_INTERVAL_MS = 3000;

/** 잡이 만료·삭제돼 더 볼 게 없는 상태(404)인지. 그 외 오류는 일시적인 것으로 본다. */
function isJobGone(error: unknown): boolean {
  return Boolean(error) && (error as { status?: number }).status === 404;
}

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
  // 서버(Object Storage)에 저장된 취향 사진 URL
  const [savedPhotoUrls, setSavedPhotoUrls] = useState<string[]>([]);
  // 추가/삭제 후 아직 분석에 반영되지 않은 사진이 있는지
  const [photosDirty, setPhotosDirty] = useState(false);
  // 진행 중인 분석 잡. 페이지를 떠났다 돌아와도 localStorage 에서 복원한다.
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  // 마지막으로 저장된(or 하이드레이트된) 폼 스냅샷 — 변경 여부 판단용
  const [savedForm, setSavedForm] = useState<PreferenceFormState>(DEFAULT_PREFERENCE_FORM);
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
    const nextForm = { ...DEFAULT_PREFERENCE_FORM, ...preferenceQuery.data.profile };
    setForm(nextForm);
    setSavedForm(nextForm);
    // 이미 사진 분석으로 저장된 취향 태그가 있으면 그대로 노출
    const tags = preferenceQuery.data.tasteTags;
    if (tags && tags.food.length + tags.mood.length + tags.environment.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버 취향 데이터로 폼을 1회 하이드레이트
      setAnalyzedTags(tags);
    }
    setSavedPhotoUrls(preferenceQuery.data.photoUrls ?? []);
  }, [preferenceQuery.data]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  // 새로고침·페이지 이동으로 돌아왔을 때 진행 중이던 분석을 다시 따라간다.
  useEffect(() => {
    const stored = readAnalysisJob();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 진행 중이던 분석 잡을 localStorage 에서 복원
    if (stored) setActiveJobId(stored);
  }, []);

  const analysisJobQuery = useQuery({
    queryKey: queryKeys.preferences.analysisJob(activeJobId ?? ''),
    queryFn: async () => {
      const session = getStoredSession();
      if (!session || !activeJobId) return null;
      return getPreferenceAnalysisJob(session.tokens.accessToken, activeJobId);
    },
    enabled: Boolean(activeJobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // 끝났거나 잡이 만료돼 사라졌으면 그만 물어본다.
      return status && status !== 'queued' && status !== 'running' ? false : JOB_POLL_INTERVAL_MS;
    },
    // 잡이 사라진(404) 게 아니면 일시적 오류로 보고 몇 번 더 물어본다.
    retry: (failureCount, error) => !isJobGone(error) && failureCount < 3,
  });

  const analysisJob = analysisJobQuery.data;
  // 폴링이 일시적으로 실패해도 배너를 유지한다 — 잡은 서버에서 계속 돌고 있다.
  const analyzing =
    Boolean(activeJobId) &&
    (!analysisJob || analysisJob.status === 'queued' || analysisJob.status === 'running');

  // 분석이 끝나면 결과를 화면에 반영하고 잡 추적을 끝낸다.
  useEffect(() => {
    if (!activeJobId || !analysisJob) return;
    if (analysisJob.status === 'queued' || analysisJob.status === 'running') return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- 분석 완료 시 잡 추적 종료(쿼리 무효화 side-effect 동반)
    setActiveJobId(null);
    forgetAnalysisJob();
    queryClient.invalidateQueries({ queryKey: queryKeys.preferences.me });
    // 새로 분석된 사진의 태그 목록을 받아온다.
    queryClient.invalidateQueries({ queryKey: queryKeys.preferences.photoTags });

    if (analysisJob.status === 'failed') {
      setNotice({
        title: '사진 분석 실패',
        description: analysisJob.error ?? '사진 분석에 실패했습니다.',
        tone: 'red',
      });
      return;
    }
    if (analysisJob.status !== 'completed') return;

    setSavedPhotoUrls(analysisJob.photoUrls);
    const tags = analysisJob.tasteTags;
    if (tags) setAnalyzedTags(tags);
    const count = tags ? tags.food.length + tags.mood.length + tags.environment.length : 0;
    setNotice(null);
    setToast({
      title: '사진 분석 완료',
      message:
        count > 0
          ? '사진에서 취향을 분석했어요.'
          : '뚜렷한 취향을 찾지 못했어요. 다른 사진을 올려보세요.',
    });
  }, [activeJobId, analysisJob, queryClient]);

  /**
   * 잡이 만료돼 사라진(404) 경우에만 추적을 끝낸다.
   * 일시적인 네트워크·서버 오류로 추적을 버리면 서버에선 분석이 도는데 화면은
   * 진행률을 잃고, localStorage 까지 지워져 새로고침으로도 복구되지 않는다.
   */
  useEffect(() => {
    if (!isJobGone(analysisJobQuery.error)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 잡 만료(404) 시 추적 종료(쿼리 무효화 동반)
    setActiveJobId(null);
    forgetAnalysisJob();
    queryClient.invalidateQueries({ queryKey: queryKeys.preferences.me });
  }, [analysisJobQuery.error, queryClient]);

  // 선택한 사진의 미리보기 URL 생성/해제
  useEffect(() => {
    const urls = photos.map((file) => URL.createObjectURL(file));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 미리보기 objectURL 생성/해제(cleanup 동반 effect)
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [photos]);

  useEffect(() => {
    if (preferenceQuery.error instanceof Error) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 쿼리 에러를 안내 토스트로 표시
      setNotice({
        title: '불러오기 실패',
        description: preferenceQuery.error.message,
        tone: 'red',
      });
    }
  }, [preferenceQuery.error]);

  // 저장된 사진을 뺀 잔여 슬롯. 0 이면 기존 사진을 지워야 더 올릴 수 있다.
  const photoAllowance = Math.max(0, MAX_PREFERENCE_PHOTOS - savedPhotoUrls.length);

  const ready =
    form.likedThemes.length > 0 &&
    form.transportModes.length > 0 &&
    form.wakeTime !== form.sleepTime;

  // 저장되지 않은 변경(폼 편집 or 미분석 사진)이 있는지. 분석된 사진은 이미 서버에 반영됨.
  const dirty = JSON.stringify(form) !== JSON.stringify(savedForm) || photosDirty;

  // 저장 전 페이지 이탈(새로고침·탭 닫기·주소 이동) 시 브라우저 경고
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const savePreferenceMutation = useMutation({
    mutationFn: async (nextForm: PreferenceFormState) => {
      const session = getStoredSession() ?? (await startDemoSession());
      return savePreferences(session.tokens.accessToken, nextForm);
    },
    onSuccess: (preference, variables) => {
      queryClient.setQueryData(queryKeys.preferences.me, preference);
      setHasSession(true);
      setSavedForm(variables);
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
    onSuccess: (job) => {
      setHasSession(true);
      // 사진은 이미 서버에 보관됐고, 태그 분석만 잡에서 이어진다.
      setSavedPhotoUrls(job.photoUrls);
      setPhotos([]);
      setPhotosDirty(false);
      rememberAnalysisJob(job.jobId);
      setActiveJobId(job.jobId);
      setNotice(null);
      setToast({
        title: '분석을 시작했어요',
        message: '완료되면 알림으로 알려드릴게요. 다른 페이지로 이동해도 괜찮아요.',
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

  // 사진별로 어떤 태그가 나왔는지 + 사용자가 켜둔 상태
  const photoTagsQuery = useQuery({
    queryKey: queryKeys.preferences.photoTags,
    queryFn: async () => {
      const session = getStoredSession();
      if (!session) return [];
      return getPreferencePhotoTags(session.tokens.accessToken);
    },
    enabled: hasSession,
  });

  const togglePhotoTagMutation = useMutation({
    mutationFn: async (input: { url: string; tag: TasteTagValue; enabled: boolean }) => {
      const session = getStoredSession() ?? (await startDemoSession());
      return togglePreferencePhotoTag(session.tokens.accessToken, input);
    },
    onSuccess: (result) => {
      // 서버가 남은 태그로 다시 집계한 결과를 그대로 반영한다.
      setAnalyzedTags(result.tasteTags);
      queryClient.setQueryData(queryKeys.preferences.photoTags, result.photos);
      queryClient.invalidateQueries({ queryKey: queryKeys.preferences.me });
    },
    onError: (error) => {
      setNotice({
        title: '태그 변경 실패',
        description: error instanceof Error ? error.message : '태그를 변경하지 못했습니다.',
        tone: 'red',
      });
    },
  });

  const deletePhotoMutation = useMutation({
    mutationFn: async (url: string) => {
      const session = getStoredSession() ?? (await startDemoSession());
      return deletePreferencePhoto(session.tokens.accessToken, url);
    },
    onSuccess: (result) => {
      setSavedPhotoUrls(result.photoUrls);
      // 남은 사진으로 태그가 다시 집계되므로 화면 태그도 갱신한다.
      if (result.tasteTags) setAnalyzedTags(result.tasteTags);
      queryClient.setQueryData(queryKeys.preferences.photoTags, result.photos);
      queryClient.invalidateQueries({ queryKey: queryKeys.preferences.me });
    },
    onError: (error) => {
      setNotice({
        title: '사진 삭제 실패',
        description: error instanceof Error ? error.message : '사진 삭제에 실패했습니다.',
        tone: 'red',
      });
    },
  });

  const photoTagsByUrl = useMemo(
    () => new Map((photoTagsQuery.data ?? []).map((photo) => [photo.url, photo.tags])),
    [photoTagsQuery.data],
  );

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
            className="h-20 animate-pulse rounded-[16px] bg-[color:var(--card-soft)]"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="wvr-scope space-y-8">
      <SetupBlock title="테마/장소 선호도">
        <p className="-mt-1 mb-3 text-[13px] font-medium leading-5 text-[color:var(--ink-faint)]">
          좋아하는 건 선호, 피하고 싶은 건 불호로 골라주세요. 고르지 않으면 중립이에요.
        </p>
        <div className="space-y-4">
          {THEME_GROUPS.map((group) => (
            <div key={group.key}>
              <h3 className="mb-1.5 text-[13px] font-bold leading-5 text-[color:var(--ink-sub)]">
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
          {/* 하루의 리듬 — 목업 가로 밴드를 실제 취침/기상 값으로 시각화(REQ-WVR-020, 읽기 전용 요약) */}
          <RhythmBand wakeTime={form.wakeTime} sleepTime={form.sleepTime} />
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
          <p className="-mt-1 mb-3 text-[13px] font-medium leading-5 text-[color:var(--ink-faint)]">
            좋아하는 장소·음식 사진을 올리면 취향을 자동으로 분석해요. (한 번에{' '}
            {MAX_PREFERENCE_UPLOAD}장, 총 {MAX_PREFERENCE_PHOTOS}장)
          </p>
          {analyzing ? <AnalysisProgress job={analysisJob} /> : null}
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
          {savedPhotoUrls.length > 0 ? (
            <div className="mb-3">
              <div className="mb-1.5 text-[12px] font-semibold text-[color:var(--ink-faint)]">
                저장된 사진 {savedPhotoUrls.length}장 · 태그를 눌러 켜고 끌 수 있어요
              </div>
              <ul className="space-y-2">
                {savedPhotoUrls.map((url) => {
                  const photoTags = photoTagsByUrl.get(url) ?? [];
                  return (
                    <SavedPhotoRow
                      key={url}
                      url={url}
                      tags={photoTags}
                      // 태그가 아직 없는 사진은, 분석 잡이 돌거나 목록을 불러오는 중이면
                      // "취향 없음" 이 아니라 "분석 중" 으로 보여야 한다.
                      pending={
                        photoTags.length === 0 && (analyzing || photoTagsQuery.isLoading)
                      }
                      busy={togglePhotoTagMutation.isPending || deletePhotoMutation.isPending}
                      onToggle={(tag, enabled) =>
                        togglePhotoTagMutation.mutate({ url, tag, enabled })
                      }
                      onDelete={() => deletePhotoMutation.mutate(url)}
                    />
                  );
                })}
              </ul>
            </div>
          ) : null}
          <div
            onDragOver={(event) => event.preventDefault()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              // 자식 요소로 이동할 때 깜빡임 방지
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDragActive(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              addPhotos(event.dataTransfer.files);
            }}
            className={`rounded-[14px] border border-dashed p-3 transition ${
              dragActive
                ? 'border-[color:var(--primary)] bg-[color:var(--primary-tint)]'
                : 'border-[color:var(--line)]'
            }`}
          >
            <div className="flex flex-wrap gap-2">
              {previews.map((url, index) => (
                <div key={url} className="relative size-20 overflow-hidden rounded-[16px]">
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
              {photos.length < Math.min(MAX_PREFERENCE_UPLOAD, photoAllowance) ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex size-20 flex-col items-center justify-center gap-1.5 rounded-[16px] border border-dashed border-[color:var(--line-dot)] bg-[color:var(--card)] text-[color:var(--primary-deep)] transition-colors hover:border-[color:var(--primary)] hover:bg-[color:var(--primary-tint)]"
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-[color:var(--primary-tint)]">
                    <FiImage className="size-4" aria-hidden />
                  </span>
                  <span className="text-[11px] font-semibold">사진 추가</span>
                </button>
              ) : null}
              {/* 빈 상태 무드 스와치 — 어떤 사진을 올리면 좋을지 톤으로 암시(장식용, 목업의
                  sea/alley 스와치 언어). 사진이 하나라도 생기면 사라진다. */}
              {previews.length === 0 && savedPhotoUrls.length === 0 ? (
                <>
                  <div
                    aria-hidden="true"
                    className="relative flex size-20 items-end overflow-hidden rounded-[16px] opacity-80"
                    style={{
                      background:
                        'linear-gradient(165deg, var(--sky-top) 0%, var(--sea-1) 45%, var(--sea-3) 100%)',
                    }}
                  >
                    <span className="w-full px-2 pb-1.5 text-[10px] font-semibold text-white/90">
                      바다 감성
                    </span>
                  </div>
                  <div
                    aria-hidden="true"
                    className="relative flex size-20 items-end overflow-hidden rounded-[16px] opacity-80"
                    style={{
                      background:
                        'linear-gradient(165deg, var(--hl) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
                    }}
                  >
                    <span className="w-full px-2 pb-1.5 text-[10px] font-semibold text-white/90">
                      골목 감성
                    </span>
                  </div>
                </>
              ) : null}
            </div>
            <p className="mt-2 text-[12px] font-medium text-[color:var(--ink-faint)]">
              사진을 여기로 끌어다 놓아도 돼요. 바다든 골목이든, 눈이 오래 머문 사진이면 충분해요.
            </p>
          </div>

          {photos.length > 0 ? (
            <button
              type="button"
              onClick={() => analyzePhotosMutation.mutate(photos)}
              disabled={analyzePhotosMutation.isPending || analyzing}
              className="mt-3 h-11 w-full rounded-[14px] bg-[color:var(--primary-tint)] text-[14px] font-bold text-[color:var(--primary-deep)] transition active:scale-[0.99] disabled:text-[color:var(--ink-faint)] lg:max-w-[280px]"
            >
              {analyzePhotosMutation.isPending
                ? '올리는 중…'
                : analyzing
                  ? '분석이 끝나면 이어서 올릴 수 있어요'
                  : `사진 ${photos.length}장으로 취향 분석하기`}
            </button>
          ) : null}

          {analyzedTags ? (
            <div className="mt-3">
              <div className="text-[12px] font-semibold text-[color:var(--ink-faint)]">분석된 취향 태그</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[...analyzedTags.food, ...analyzedTags.mood, ...analyzedTags.environment].map(
                  (tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-[color:var(--primary-tint)] px-3 py-1 text-[13px] font-bold text-[color:var(--primary-deep)]"
                    >
                      {TASTE_TAG_LABELS[tag] ?? tag}
                    </span>
                  ),
                )}
                {analyzedTags.food.length +
                  analyzedTags.mood.length +
                  analyzedTags.environment.length ===
                0 ? (
                  <span className="text-[13px] font-medium text-[color:var(--ink-faint)]">
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
        <div className="space-y-2.5 lg:mx-auto lg:max-w-[420px]">
          <button
            type="button"
            disabled={savePreferenceMutation.isPending || !ready}
            onClick={handleSubmit}
            className="h-14 w-full rounded-[18px] bg-[color:var(--btn-bg)] text-[16px] font-bold text-[color:var(--btn-text)] shadow-[var(--shadow-btn)] transition-colors hover:bg-[color:var(--btn-bg-press)] disabled:bg-[color:var(--line)] disabled:text-[color:var(--ink-faint)] disabled:shadow-none"
          >
            {savePreferenceMutation.isPending ? '저장 중' : '취향 저장'}
          </button>
          <button
            type="button"
            onClick={() => setResetDialogOpen(true)}
            className="h-12 w-full rounded-[18px] bg-[color:var(--card-soft)] text-[15px] font-semibold text-[color:var(--ink-sub)] transition-colors hover:bg-[color:var(--line)]"
          >
            기본값 되돌리기
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={resetDialogOpen}
        title="기본값으로 되돌릴까요?"
        description="선택한 취향이 모두 초기화돼요. 저장하기 전까지는 반영되지 않아요."
        confirmLabel="되돌리기"
        cancelLabel="취소"
        danger
        onConfirm={resetToDefaults}
        onCancel={() => setResetDialogOpen(false)}
      />
    </div>
  );

  function resetToDefaults() {
    setForm(DEFAULT_PREFERENCE_FORM);
    setPhotos([]);
    setPhotosDirty(false);
    setNotice(null);
    setResetDialogOpen(false);
  }

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

    // 한 번에 3장, 저장된 사진까지 합쳐 총 10장을 넘길 수 없다.
    const remainingTotal = Math.max(0, MAX_PREFERENCE_PHOTOS - savedPhotoUrls.length);
    const allowance = Math.min(MAX_PREFERENCE_UPLOAD, remainingTotal);
    setPhotos((current) => {
      const merged = [...current, ...valid].slice(0, allowance);
      if (merged.length < current.length + valid.length) {
        setNotice({
          title: '사진 수 제한',
          description:
            remainingTotal === 0
              ? `취향 사진은 최대 ${MAX_PREFERENCE_PHOTOS}장까지예요. 기존 사진을 지우고 올려주세요.`
              : `한 번에 ${MAX_PREFERENCE_UPLOAD}장까지, 총 ${MAX_PREFERENCE_PHOTOS}장까지 올릴 수 있어요.`,
          tone: 'red',
        });
      }
      return merged;
    });
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
          ? 'bg-[color:var(--primary-tint)] text-[color:var(--primary-deep)] ring-2 ring-[color:var(--primary)]'
          : 'bg-[color:var(--card-soft)] text-[color:var(--ink-faint)]'
      }`}
    >
      <span className="text-[14px] font-bold leading-5">{label}</span>
      {hint ? <span className="text-[11px] font-medium leading-4 opacity-70">{hint}</span> : null}
    </button>
  );
}

/**
 * 저장된 사진 한 장 + 그 사진에서 뽑힌 태그.
 * 태그 칩을 누르면 집계에서 빼거나 다시 넣는다 (분석 결과 자체는 서버에 남아 복원 가능).
 */
function SavedPhotoRow({
  url,
  tags,
  pending,
  busy,
  onToggle,
  onDelete,
}: {
  url: string;
  tags: Array<{ tag: TasteTagValue; enabled: boolean }>;
  pending: boolean;
  busy: boolean;
  onToggle: (tag: TasteTagValue, enabled: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex gap-3 rounded-[14px] border border-[color:var(--line)] p-2">
      <div className="relative size-16 shrink-0 overflow-hidden rounded-[12px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="size-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {tags.map(({ tag, enabled }) => (
              <button
                key={tag}
                type="button"
                onClick={() => onToggle(tag, !enabled)}
                disabled={busy}
                aria-pressed={enabled}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-bold transition disabled:opacity-50 ${
                  enabled
                    ? 'bg-[color:var(--primary-tint)] text-[color:var(--primary-deep)]'
                    : 'bg-[color:var(--card-soft)] text-[color:var(--ink-faint)] line-through'
                }`}
              >
                {enabled ? (
                  <FiCheck className="size-3" aria-hidden />
                ) : (
                  <FiPlus className="size-3" aria-hidden />
                )}
                {TASTE_TAG_LABELS[tag] ?? tag}
              </button>
            ))}
          </div>
        ) : pending ? (
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-[color:var(--ink-faint)]">
            <FiLoader className="size-3.5 animate-spin" aria-hidden />
            취향을 분석하고 있어요…
          </p>
        ) : (
          <p className="text-[13px] font-medium text-[color:var(--ink-faint)]">
            이 사진에서는 뚜렷한 취향을 찾지 못했어요.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label="사진 삭제"
        className="size-7 shrink-0 self-start rounded-full text-[color:var(--ink-faint)] transition hover:bg-[color:var(--card-soft)] disabled:opacity-50"
      >
        <FiX className="mx-auto size-4" aria-hidden />
      </button>
    </li>
  );
}

/**
 * 분석 진행 표시. 사진 1장에 30초 넘게 걸려 "몇 장 중 몇 장" 을 같이 보여준다.
 * 큐 대기 중에는 아직 분석한 장이 없으므로 진행률 대신 대기 문구를 쓴다.
 */
function AnalysisProgress({ job }: { job: PreferenceAnalysisJobDto | null | undefined }) {
  const total = job?.total ?? 0;
  const analyzed = job?.analyzed ?? 0;
  // 아직 첫 조회 응답이 없거나(또는 폴링이 잠깐 실패) 대기 중이면 진행률 대신 대기 문구를 쓴다.
  const queued = !job || job.status === 'queued';
  const percent = total > 0 ? Math.round((analyzed / total) * 100) : 0;

  return (
    <div className="mb-3 rounded-[14px] border border-[color:var(--primary-tint)] bg-[color:var(--primary-tint)] p-3">
      <div className="flex items-center gap-2">
        <FiLoader className="size-4 animate-spin text-[color:var(--primary-deep)]" aria-hidden />
        <span className="text-[13px] font-bold text-[color:var(--primary-deep)]">
          {queued ? '분석 대기 중이에요' : `취향 분석 중… ${analyzed}/${total}장`}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/70"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="취향 분석 진행률"
      >
        <div
          className="h-full rounded-full bg-[color:var(--primary)] transition-[width] duration-500"
          style={{ width: `${queued ? 0 : percent}%` }}
        />
      </div>
      <p className="mt-2 text-[12px] font-medium leading-4 text-[color:var(--primary-deep)]/80">
        사진 한 장에 30초 정도 걸려요. 완료되면 알림으로 알려드릴게요 — 이 페이지를 떠나도
        분석은 계속됩니다.
      </p>
    </div>
  );
}

function SetupBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[22px] border border-[color:var(--line)] bg-[color:var(--card)] p-5 shadow-[var(--shadow-card)]">
      <h2 className="mb-3 text-[18px] font-black leading-6 text-[color:var(--ink)]">{title}</h2>
      {children}
    </section>
  );
}

/**
 * 하루의 리듬 — 목업 가로 밴드(그라데이션 + 취침/기상 핸들)를 실제
 * form.wakeTime/form.sleepTime 값으로 렌더하는 읽기 전용 시각 요약(REQ-WVR-020).
 * 새 폼 상태를 추가하지 않는다 — TimeField 입력값을 그대로 반영만 한다.
 */
function RhythmBand({ wakeTime, sleepTime }: { wakeTime: string; sleepTime: string }) {
  const wakePct = timeToDayPercent(wakeTime);
  const sleepPct = timeToDayPercent(sleepTime);
  return (
    <div className="mt-4">
      <div
        className="mb-1.5 flex justify-between font-mono text-[10.5px] text-[color:var(--ink-faint)]"
        aria-hidden="true"
      >
        <span>0시</span>
        <span>6시</span>
        <span>12시</span>
        <span>18시</span>
        <span>24시</span>
      </div>
      <div
        className="relative h-3 rounded-full border border-[color:var(--line)] bg-[color:var(--card-soft)]"
        role="img"
        aria-label={`깨어 있는 시간: ${wakeTime}부터 ${sleepTime}까지`}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-px rounded-full"
          style={{
            left: `${wakePct}%`,
            right: `${100 - sleepPct}%`,
            background:
              'linear-gradient(90deg, var(--t-morning) 0%, var(--t-noon) 38%, var(--t-gold) 74%, var(--t-dusk) 100%)',
          }}
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px]"
          style={{ left: `${wakePct}%`, background: 'var(--card)', borderColor: 'var(--t-morning)' }}
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px]"
          style={{ left: `${sleepPct}%`, background: 'var(--card)', borderColor: 'var(--t-dusk)' }}
        />
      </div>
      <p className="mt-2 text-[12.5px] text-[color:var(--ink-faint)]">
        일정은 이 리듬 안에서만 짜 드려요.
      </p>
    </div>
  );
}

/** "HH:mm" → 0~100 사이 하루 중 위치(%) 순수 함수. */
function timeToDayPercent(time: string): number {
  const parts = time.split(':').map(Number);
  const h = parts[0] ?? Number.NaN;
  const m = parts[1] ?? 0;
  if (Number.isNaN(h)) return 0;
  const minutes = h * 60 + (Number.isNaN(m) ? 0 : m);
  return Math.min(100, Math.max(0, (minutes / (24 * 60)) * 100));
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
    <div className="flex items-center justify-between gap-2 rounded-[12px] bg-[color:var(--card-soft)] px-3 py-1.5">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-[14px] font-bold leading-6 text-[color:var(--ink)]">{label}</span>
        <span className="truncate text-[11px] font-medium text-[color:var(--ink-faint)]">
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
  const activeClass = like ? 'bg-[color:var(--primary)] text-white' : 'bg-[color:var(--danger)] text-white';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`flex size-7 items-center justify-center rounded-full transition ${
        active ? activeClass : 'bg-[color:var(--card)] text-[color:var(--ink-faint)]'
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
