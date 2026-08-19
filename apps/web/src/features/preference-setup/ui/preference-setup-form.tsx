'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LuCheck,
  LuCircleAlert,
  LuLoader,
  LuLock,
  LuPlus,
  LuRefreshCw,
  LuRotateCcw,
  LuThumbsDown,
  LuThumbsUp,
  LuX,
} from 'react-icons/lu';
import {
  MAX_PREFERENCE_PHOTOS,
  MAX_PREFERENCE_UPLOAD,
  type PreferenceAnalysisJobDto,
  type PreferencePhotoTagsDto,
  type TasteTagDto,
  type TasteTagValue,
  type ThemePreference,
} from '@tripick/types';
import {
  ACTIVITY_INTENSITY_OPTIONS,
  CROWD_OPTIONS,
  PACE_OPTIONS,
  TASTE_TAG_LABELS,
  THEME_GROUPS,
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
  reanalyzePreferencePhotos,
  rememberAnalysisJob,
  savePreferences,
  togglePreferencePhotoTag,
  type PreferenceFormState,
} from '@/entities/preferences/api/preferences-api';
import { getStoredSession, type Session } from '@/entities/session/model/session-storage';
import { queryKeys } from '@/shared/api/query-keys';
import { downscaleImage, PREFERENCE_MAX_DIMENSION } from '@/shared/lib';
import { Button, ConfirmDialog, ImageLightbox, TimeField, Toast } from '@/shared/ui';

type ToastState = {
  title: string;
  message?: string;
  tone: 'success' | 'error';
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
  const [toast, setToast] = useState<ToastState | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [analyzedTags, setAnalyzedTags] = useState<TasteTagDto | null>(null);
  // 서버(Object Storage)에 저장된 취향 사진 URL
  const [savedPhotoUrls, setSavedPhotoUrls] = useState<string[]>([]);
  // 추가/삭제 후 아직 분석에 반영되지 않은 사진이 있는지
  const [photosDirty, setPhotosDirty] = useState(false);
  // 확대 보기(라이트박스)로 띄운 이미지 URL. null 이면 닫힘.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
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
    // 에러는 읽을 시간을 더 준다(성공 2.5s / 에러 4s). 둘 다 닫기 버튼으로 즉시 닫을 수 있다.
    const timer = setTimeout(() => setToast(null), toast.tone === 'error' ? 4000 : 2500);
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
      setToast({
        title: '사진 분석 실패',
        message: analysisJob.error ?? '사진 분석에 실패했습니다.',
        tone: 'error',
      });
      return;
    }
    if (analysisJob.status !== 'completed') return;

    setSavedPhotoUrls(analysisJob.photoUrls);
    const tags = analysisJob.tasteTags;
    if (tags) setAnalyzedTags(tags);
    const count = tags ? tags.food.length + tags.mood.length + tags.environment.length : 0;
    setToast({
      title: '사진 분석 완료',
      message:
        count > 0
          ? '사진에서 취향을 분석했어요.'
          : '뚜렷한 취향을 찾지 못했어요. 다른 사진을 올려보세요.',
      tone: 'success',
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
      setToast({
        title: '불러오기 실패',
        message: preferenceQuery.error.message,
        tone: 'error',
      });
    }
  }, [preferenceQuery.error]);

  // 저장된 사진을 뺀 잔여 슬롯. 0 이면 기존 사진을 지워야 더 올릴 수 있다.
  const photoAllowance = Math.max(0, MAX_PREFERENCE_PHOTOS - savedPhotoUrls.length);

  const ready = form.likedThemes.length > 0 && form.wakeTime !== form.sleepTime;

  /**
   * 저장 CTA 가 왜 막혀 있는지(또는 무엇이 아직 반영 안 됐는지) 알려주는 문구.
   * 목업 .cta-hint 자리에 대응하며, `ready` 판정식에서 파생만 한다 — 새 폼 상태 없음.
   */
  const ctaHint = !ready
    ? form.likedThemes.length === 0
      ? '선호하는 테마를 하나 이상 골라야 저장할 수 있어요'
      : '취침·기상 시각을 서로 다르게 맞춰 주세요'
    : photos.length > 0 && photosDirty
      ? '추가한 사진은 “취향 분석하기”를 눌러야 취향에 반영돼요'
      : null;

  // 저장되지 않은 변경(폼 편집 or 미분석 사진)이 있는지. 분석된 사진은 이미 서버에 반영됨.
  const dirty = JSON.stringify(form) !== JSON.stringify(savedForm) || photosDirty;

  // 목업 pick-grid 는 3열 · 2행(6칸)을 늘 채운다 — 남는 칸은 "디자인된 여백"(빈 슬롯).
  // 그리드에는 이미 반영된 사진(저장본)과 아직 분석 전인 사진(선택본)을 함께 올린다.
  const canAddMore = photos.length < Math.min(MAX_PREFERENCE_UPLOAD, photoAllowance);
  const showMoodSwatches = previews.length === 0 && savedPhotoUrls.length === 0;
  const filledTiles =
    savedPhotoUrls.length + previews.length + (canAddMore ? 1 : 0) + (showMoodSwatches ? 2 : 0);
  // 빈 슬롯은 실제로 더 올릴 수 있는 만큼만 그린다(총 10장 상한을 넘겨 기대를 주지 않도록).
  const ghostSlots = canAddMore
    ? Math.min(Math.max(0, 6 - filledTiles), Math.max(0, photoAllowance - photos.length - 1))
    : 0;

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
      const session = requireSession();
      return savePreferences(session.tokens.accessToken, nextForm);
    },
    onSuccess: (preference, variables) => {
      queryClient.setQueryData(queryKeys.preferences.me, preference);
      setHasSession(true);
      setSavedForm(variables);
      setToast({ title: '저장 완료', message: '취향을 저장했습니다.', tone: 'success' });
    },
    onError: (error) => {
      setToast({
        title: '저장 실패',
        message: error instanceof Error ? error.message : '취향 저장에 실패했습니다.',
        tone: 'error',
      });
    },
  });

  const analyzePhotosMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const session = requireSession();
      // vision 분석은 해상도를 쓰므로 표시 크기(80px)보다 큰 1024px 로만 줄인다.
      // 포맷은 jpeg — 로컬 vision 서버(llama.cpp mtmd=stb_image)가 webp 를 못 읽는다.
      const downscaled = await Promise.all(
        files.map((file) =>
          downscaleImage(file, {
            maxDimension: PREFERENCE_MAX_DIMENSION,
            format: 'image/jpeg',
          }),
        ),
      );
      return analyzePreferenceImages(session.tokens.accessToken, downscaled);
    },
    onSuccess: (job) => {
      setHasSession(true);
      // 사진은 이미 서버에 보관됐고, 태그 분석만 잡에서 이어진다.
      setSavedPhotoUrls(job.photoUrls);
      setPhotos([]);
      setPhotosDirty(false);
      rememberAnalysisJob(job.jobId);
      setActiveJobId(job.jobId);
      setToast({
        title: '분석을 시작했어요',
        message: '완료되면 알림으로 알려드릴게요. 다른 페이지로 이동해도 괜찮아요.',
        tone: 'success',
      });
    },
    onError: (error) => {
      setToast({
        title: '사진 분석 실패',
        message: error instanceof Error ? error.message : '사진 분석에 실패했습니다.',
        tone: 'error',
      });
    },
  });

  const reanalyzePhotosMutation = useMutation({
    mutationFn: async () => {
      const session = requireSession();
      return reanalyzePreferencePhotos(session.tokens.accessToken);
    },
    onSuccess: (job) => {
      // 새 사진이 없으므로 목록은 그대로고, 잡 추적만 업로드와 같은 경로로 이어간다.
      rememberAnalysisJob(job.jobId);
      setActiveJobId(job.jobId);
      setToast({
        title: '다시 분석할게요',
        message: '완료되면 알림으로 알려드릴게요. 다른 페이지로 이동해도 괜찮아요.',
        tone: 'success',
      });
    },
    onError: (error) => {
      setToast({
        title: '재분석 실패',
        message: error instanceof Error ? error.message : '사진을 다시 분석하지 못했습니다.',
        tone: 'error',
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
      const session = requireSession();
      return togglePreferencePhotoTag(session.tokens.accessToken, input);
    },
    onSuccess: (result) => {
      // 서버가 남은 태그로 다시 집계한 결과를 그대로 반영한다.
      setAnalyzedTags(result.tasteTags);
      queryClient.setQueryData(queryKeys.preferences.photoTags, result.photos);
      queryClient.invalidateQueries({ queryKey: queryKeys.preferences.me });
    },
    onError: (error) => {
      setToast({
        title: '태그 변경 실패',
        message: error instanceof Error ? error.message : '태그를 변경하지 못했습니다.',
        tone: 'error',
      });
    },
  });

  const deletePhotoMutation = useMutation({
    mutationFn: async (url: string) => {
      const session = requireSession();
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
      setToast({
        title: '사진 삭제 실패',
        message: error instanceof Error ? error.message : '사진 삭제에 실패했습니다.',
        tone: 'error',
      });
    },
  });

  const photoTagsByUrl = useMemo(
    () => new Map((photoTagsQuery.data ?? []).map((photo) => [photo.url, photo])),
    [photoTagsQuery.data],
  );

  /**
   * 분석 결과가 없는 저장된 사진 수. 잡이 재시도까지 실패하면 남는다.
   * 자동 복구는 "다음 업로드"에 편승하는데, 사진 10장을 다 채우면 그 기회가 없어
   * 사용자가 하나를 지우기 전까지 무신호로 남는다 — 전용 버튼으로 그 막힘을 푼다.
   */
  const unanalyzedCount = useMemo(
    () => (photoTagsQuery.data ?? []).filter((photo) => !photo.analyzed).length,
    [photoTagsQuery.data],
  );

  function handleSubmit() {
    if (!ready) {
      setToast({
        title: '확인 필요',
        message: '선호 테마를 하나 이상 고르고, 취침·기상 시각을 다르게 설정해주세요.',
        tone: 'error',
      });
      return;
    }
    if (photos.length > 0 && photosDirty) {
      setToast({
        title: '사진 분석 먼저',
        message: '추가한 사진을 “취향 분석하기”로 먼저 반영한 뒤 저장해주세요.',
        tone: 'error',
      });
      return;
    }
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
    // wvr-scope 를 여기 다시 붙이지 않는다 — 이 화면 셸(AppFrame themed)이 이미 스코프라
    // 토큰은 그대로 상속되고, 중첩하면 `.wvr-scope{background:var(--bg)}` 가 --app-surface
    // 컬럼 위에 --bg 사각형을 덧칠해 카드 없는 구간(CTA 아래)이 검은 블록으로 뜬다.
    <div className="space-y-8">
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
        {/* 옆 "여행 스타일" 카드가 조금 더 길어 남는 높이가 이 카드 아래에 몰린다.
            안쪽을 세로 flex 로 잡고 리듬 밴드를 mt-auto 로 내려, 남는 여백을 시간 입력과
            밴드 사이로 흘려보낸다(카드 바닥에 뭉치지 않게). */}
        <SetupBlock title="취침 / 기상 시간" className="flex flex-col">
          <div className="flex flex-1 flex-col">
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
            <div className="mt-auto">
              <RhythmBand wakeTime={form.wakeTime} sleepTime={form.sleepTime} />
            </div>
          </div>
        </SetupBlock>

        {/* 페이스·활동 강도·분위기는 3지선다 한 줄짜리라 카드를 따로 두면 카드마다 여백만
            남는다(특히 홀수라 마지막 칸이 통째로 빈다). 한 카드 안 소제목으로 묶어 취침/기상
            카드와 높이를 맞춘다. */}
        <SetupBlock title="여행 스타일">
          <p className="-mt-1 mb-3 text-[13px] font-medium leading-5 text-[color:var(--ink-faint)]">
            하루에 몇 곳을, 얼마나 힘 있게, 어떤 분위기로 다닐지 정해요.
          </p>
          <div className="space-y-3.5">
            <StyleGroup
              label="여행 페이스"
              options={PACE_OPTIONS}
              value={form.pace}
              onSelect={(value) => setSingle('pace', value)}
            />
            <StyleGroup
              label="활동 강도"
              options={ACTIVITY_INTENSITY_OPTIONS}
              value={form.activityIntensity}
              onSelect={(value) => setSingle('activityIntensity', value)}
            />
            <StyleGroup
              label="분위기"
              options={CROWD_OPTIONS}
              value={form.crowdPreference}
              onSelect={(value) => setSingle('crowdPreference', value)}
            />
          </div>
        </SetupBlock>
      </div>

      {/* 사진 분석은 폼 마지막 단계 — 직접 정하는 항목을 먼저 채우고 사진으로 보강한다. */}
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
          className={`rounded-[16px] p-1.5 transition ${
            dragActive
              ? 'bg-[color:var(--primary-tint)] ring-2 ring-[color:var(--primary)]'
              : 'bg-transparent'
          }`}
        >
          <div className="grid grid-cols-3 gap-2.5" role="group" aria-label="고른 사진">
            {/* 이미 분석에 반영된 사진 — 지우기·태그 조정은 아래 분석 결과 카드에서 한다. */}
            {savedPhotoUrls.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => setLightboxUrl(url)}
                aria-label="사진 크게 보기"
                className="relative aspect-square overflow-hidden rounded-[16px] bg-[color:var(--card-soft)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="size-full object-cover" />
                <span
                  aria-hidden
                  className="absolute left-1.5 top-1.5 flex size-[22px] items-center justify-center rounded-full border-2 border-[color:var(--card)] bg-[color:var(--primary)] text-[color:var(--btn-text)]"
                >
                  <LuCheck className="size-3" />
                </span>
              </button>
            ))}
            {previews.map((url, index) => (
              <div
                key={url}
                className="relative aspect-square overflow-hidden rounded-[16px] bg-[color:var(--card-soft)]"
              >
                <button
                  type="button"
                  onClick={() => setLightboxUrl(url)}
                  aria-label="사진 크게 보기"
                  className="size-full"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="size-full object-cover" />
                </button>
                <span
                  aria-hidden
                  className="absolute left-1.5 top-1.5 flex size-[22px] items-center justify-center rounded-full border-2 border-[color:var(--card)] bg-[color:var(--primary)] text-[color:var(--btn-text)]"
                >
                  <LuCheck className="size-3" />
                </span>
                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  aria-label="사진 제거"
                  className="absolute right-1.5 top-1.5 flex size-[22px] items-center justify-center rounded-full bg-black/55 text-white"
                >
                  <LuX className="size-3" aria-hidden />
                </button>
              </div>
            ))}
            {canAddMore ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[16px] border-[1.5px] border-dashed border-[color:var(--primary)] bg-[color:var(--primary-tint)] text-[color:var(--primary-deep)] transition hover:bg-[color:var(--card)]"
              >
                <span className="flex size-7 items-center justify-center rounded-full bg-[color:var(--card)] text-[color:var(--primary)]">
                  <LuPlus className="size-3.5" aria-hidden />
                </span>
                <span className="text-center text-[11.5px] font-bold leading-[1.3]">
                  갤러리에서
                  <br />
                  고르기
                </span>
              </button>
            ) : null}
            {/* 빈 상태 무드 스와치 — 어떤 사진을 올리면 좋을지 톤으로 암시(장식용, 목업의
                sea/alley 스와치 언어). 사진이 하나라도 생기면 사라진다. */}
            {showMoodSwatches ? (
              <>
                <MoodSwatch
                  label="바다 감성"
                  gradient="linear-gradient(165deg, var(--sky-top) 0%, var(--sea-1) 45%, var(--sea-3) 100%)"
                />
                <MoodSwatch
                  label="골목 감성"
                  gradient="linear-gradient(165deg, var(--hl) 0%, var(--accent) 55%, var(--accent-deep) 100%)"
                />
              </>
            ) : null}
            {Array.from({ length: ghostSlots }).map((_, index) => (
              <GhostSlot key={index} slot={filledTiles + index + 1} />
            ))}
          </div>
          <p className="mt-2 px-0.5 text-[12px] font-medium text-[color:var(--ink-faint)]">
            사진을 여기로 끌어다 놓아도 돼요. 바다든 골목이든, 눈이 오래 머문 사진이면 충분해요.
          </p>
        </div>

        {photos.length > 0 || savedPhotoUrls.length > 0 ? (
          <p className="mt-3 flex items-baseline justify-between gap-2 px-0.5 text-[13px] text-[color:var(--ink-sub)]">
            <span>
              <strong className="font-bold text-[color:var(--ink)]">
                {savedPhotoUrls.length + photos.length}장
              </strong>{' '}
              골랐어요
              {photos.length > 0 ? ` · ${photos.length}장은 아직 분석 전이에요` : ''}
            </span>
            {/* 숫자만 mono — 한글까지 mono 로 두면 폴백 폰트에서 자간이 깨진다. */}
            <span className="shrink-0 text-[12px] text-[color:var(--ink-faint)]">
              <span className="font-mono tracking-[0.04em]">
                {savedPhotoUrls.length + photos.length}
              </span>{' '}
              / 최대 <span className="font-mono tracking-[0.04em]">{MAX_PREFERENCE_PHOTOS}</span>
            </span>
          </p>
        ) : null}

        {photos.length > 0 ? (
          <button
            type="button"
            onClick={() => analyzePhotosMutation.mutate(photos)}
            disabled={analyzePhotosMutation.isPending || analyzing}
            className="mt-3 h-11 w-full rounded-[12px] bg-[color:var(--primary-tint)] text-[14px] font-bold text-[color:var(--primary-deep)] transition active:scale-[0.99] disabled:text-[color:var(--ink-faint)] lg:max-w-[280px]"
          >
            {analyzePhotosMutation.isPending
              ? '올리는 중…'
              : analyzing
                ? '분석이 끝나면 이어서 올릴 수 있어요'
                : `사진 ${photos.length}장으로 취향 분석하기`}
          </button>
        ) : null}

        <p className="mt-3 flex items-start gap-1.5 text-[12px] font-medium leading-5 text-[color:var(--ink-faint)]">
          <LuLock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            올린 사진은 취향 분석 용도로만 저장·사용돼요. 언제든 사진을 지우면 함께 삭제돼요.
          </span>
        </p>
      </SetupBlock>

      {/* 분석 결과 카드 — 목업 .result-card(완료 칩 · 겹친 썸네일 · 태그 그룹 · 정정 힌트) */}
      {savedPhotoUrls.length > 0 || analyzedTags ? (
        <section className="wvr-rise wvr-rise-2 rounded-[20px] border border-[color:var(--line)] bg-[color:var(--card)] p-5 shadow-[var(--shadow-card)]">
          <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[color:var(--primary-tint)] px-2 py-1 text-[11px] font-bold text-[color:var(--primary)]">
            <LuCheck className="size-3" aria-hidden />
            {analyzing ? '사진 분석 중' : '사진 분석 완료'}
          </span>
          <h2 className="mt-2.5 text-[19px] font-extrabold leading-[1.4] tracking-[-0.025em] text-[color:var(--ink)]">
            사진에서 이런 취향을 읽었어요
          </h2>

          {savedPhotoUrls.length > 0 ? (
            <div className="mt-3.5 flex items-center">
              {savedPhotoUrls.slice(0, 6).map((url, index) => (
                <span
                  key={url}
                  className={`size-10 shrink-0 overflow-hidden rounded-[12px] border-2 border-[color:var(--card)] shadow-[0_0_0_1px_var(--line)] ${
                    index > 0 ? '-ml-2.5' : ''
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="size-full object-cover" />
                </span>
              ))}
              <span className="ml-3 text-[12.5px] text-[color:var(--ink-faint)]">
                고른 사진 {savedPhotoUrls.length}장
              </span>
            </div>
          ) : null}

          {analyzedTags ? (
            <div className="mt-4">
              <p className="flex items-center gap-1.5 text-[13px] font-bold text-[color:var(--ink-sub)]">
                <span aria-hidden className="size-1.5 rounded-full bg-[color:var(--primary)]" />
                이런 게 좋아요
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {analyzedTags.food.map((tag) => (
                  <TasteChip key={tag} label={TASTE_TAG_LABELS[tag] ?? tag} tone="warm" />
                ))}
                {[...analyzedTags.mood, ...analyzedTags.environment].map((tag) => (
                  <TasteChip key={tag} label={TASTE_TAG_LABELS[tag] ?? tag} tone="cool" />
                ))}
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

          {savedPhotoUrls.length > 0 ? (
            <div className="mt-4 border-t border-dashed border-[color:var(--line)] pt-4">
              <div className="mb-2 text-[12px] font-semibold text-[color:var(--ink-faint)]">
                저장된 사진 {savedPhotoUrls.length}장 · 태그를 눌러 켜고 끌 수 있어요
              </div>
              <ul className="space-y-2">
                {savedPhotoUrls.map((url) => {
                  const photo = photoTagsByUrl.get(url);
                  return (
                    <SavedPhotoRow
                      key={url}
                      url={url}
                      tags={photo?.tags ?? []}
                      // 아직 분석되지 않은 사진은 "취향 없음" 이 아니라 그렇게 보여야 한다.
                      // 잡이 돌거나 목록을 불러오는 중이면 아직 결론이 아니라 "분석 중".
                      state={
                        photo?.analyzed
                          ? 'analyzed'
                          : analyzing || photoTagsQuery.isLoading || !photo
                            ? 'analyzing'
                            : 'unanalyzed'
                      }
                      busy={togglePhotoTagMutation.isPending || deletePhotoMutation.isPending}
                      onToggle={(tag, enabled) =>
                        togglePhotoTagMutation.mutate({ url, tag, enabled })
                      }
                      onDelete={() => deletePhotoMutation.mutate(url)}
                      onZoom={() => setLightboxUrl(url)}
                    />
                  );
                })}
              </ul>
              {unanalyzedCount > 0 && !analyzing ? (
                <button
                  type="button"
                  onClick={() => reanalyzePhotosMutation.mutate()}
                  disabled={reanalyzePhotosMutation.isPending}
                  className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-[12px] bg-[color:var(--card-soft)] text-[13px] font-bold text-[color:var(--ink-sub)] transition hover:bg-[color:var(--line)] active:scale-[0.99] disabled:text-[color:var(--ink-faint)] lg:max-w-[280px]"
                >
                  <LuRefreshCw
                    className={`size-3.5 ${reanalyzePhotosMutation.isPending ? 'animate-spin' : ''}`}
                    aria-hidden
                  />
                  {reanalyzePhotosMutation.isPending
                    ? '요청하는 중…'
                    : `분석 안 된 사진 ${unanalyzedCount}장 다시 분석`}
                </button>
              ) : null}
              <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-[1.55] text-[color:var(--ink-sub)]">
                <LuCircleAlert
                  className="mt-0.5 size-3.5 shrink-0 text-[color:var(--accent-deep)]"
                  aria-hidden
                />
                <span>잘못 읽은 태그는 눌러서 끌 수 있어요. 일정에는 켜둔 태그만 반영돼요.</span>
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {toast ? (
        <Toast
          title={toast.title}
          message={toast.message}
          tone={toast.tone}
          onClose={() => setToast(null)}
        />
      ) : null}
      {/* 폼 푸터 — 모바일은 세로(안내 → 저장 → 되돌리기), 데스크탑은 오른쪽 정렬 한 줄.
          되돌리기를 저장과 같은 크기의 덩어리로 두면 1차 액션이 둘로 보여, 텍스트 버튼으로
          낮춘다. DOM 순서는 모바일 기준이고 lg 에서만 order 로 되돌리기를 저장 왼쪽에 둔다. */}
      <div className="border-t border-[color:var(--line)] pt-6">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-end lg:gap-3">
          {/* 목업 .cta-hint — 왜 아직 저장할 수 없는지(또는 무엇이 안 반영됐는지) 알려준다. */}
          {ctaHint ? (
            <p className="text-center text-[12.5px] leading-[1.5] text-[color:var(--ink-faint)] lg:order-1 lg:mr-auto lg:text-left">
              {ctaHint}
            </p>
          ) : null}
          <Button
            size="lg"
            fullWidth
            className="shadow-[var(--shadow-btn)] disabled:shadow-none lg:order-3 lg:h-12 lg:w-auto lg:min-w-[200px] lg:px-8 lg:text-[15px]"
            disabled={savePreferenceMutation.isPending || !ready}
            onClick={handleSubmit}
          >
            {savePreferenceMutation.isPending ? '저장 중' : '취향 저장'}
          </Button>
          <button
            type="button"
            onClick={() => setResetDialogOpen(true)}
            className="mx-auto flex h-11 items-center justify-center gap-1.5 rounded-[12px] px-4 text-[13.5px] font-semibold text-[color:var(--ink-faint)] transition-colors hover:bg-[color:var(--card-soft)] hover:text-[color:var(--ink-sub)] lg:order-2 lg:mx-0"
          >
            <LuRotateCcw className="size-3.5" aria-hidden />
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

      {lightboxUrl ? (
        <ImageLightbox src={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      ) : null}
    </div>
  );

  function resetToDefaults() {
    setForm(DEFAULT_PREFERENCE_FORM);
    setPhotos([]);
    setPhotosDirty(false);
    setToast(null);
    setResetDialogOpen(false);
  }

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    const valid = incoming.filter(
      (file) => ACCEPTED_PHOTO_TYPES.includes(file.type) && file.size <= MAX_PHOTO_BYTES,
    );
    if (valid.length < incoming.length) {
      setToast({
        title: '일부 사진 제외',
        message: 'JPG·PNG·WEBP 형식의 10MB 이하 사진만 올릴 수 있어요.',
        tone: 'error',
      });
    }
    if (valid.length === 0) return;

    // 한 번에 3장, 저장된 사진까지 합쳐 총 10장을 넘길 수 없다.
    const remainingTotal = Math.max(0, MAX_PREFERENCE_PHOTOS - savedPhotoUrls.length);
    const allowance = Math.min(MAX_PREFERENCE_UPLOAD, remainingTotal);
    setPhotos((current) => {
      const merged = [...current, ...valid].slice(0, allowance);
      if (merged.length < current.length + valid.length) {
        setToast({
          title: '사진 수 제한',
          message:
            remainingTotal === 0
              ? `취향 사진은 최대 ${MAX_PREFERENCE_PHOTOS}장까지예요. 기존 사진을 지우고 올려주세요.`
              : `한 번에 ${MAX_PREFERENCE_UPLOAD}장까지, 총 ${MAX_PREFERENCE_PHOTOS}장까지 올릴 수 있어요.`,
          tone: 'error',
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

/**
 * "여행 스타일" 카드 안의 3지선다 한 줄(소제목 + 선택 카드 3개).
 * 값 타입은 그룹마다 다르므로(TravelPace·ActivityIntensity·CrowdPreference) 제네릭으로
 * 묶어 `pace` 자리에 `hotspot` 이 들어가는 식의 교차 대입을 타입으로 막는다.
 */
function StyleGroup<T extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string; hint: string }>;
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-[13px] font-bold leading-5 text-[color:var(--ink-sub)]">
        {label}
      </h3>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={label}>
        {options.map((option) => (
          <ChoiceCard
            key={option.value}
            active={value === option.value}
            label={option.label}
            hint={option.hint}
            onClick={() => onSelect(option.value)}
          />
        ))}
      </div>
    </div>
  );
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
      aria-pressed={active}
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
  state,
  busy,
  onToggle,
  onDelete,
  onZoom,
}: {
  url: string;
  tags: PreferencePhotoTagsDto['tags'];
  /** 'unanalyzed' = 분석 결과가 아직 없음(잡 실패), 'analyzed' = 결과 있음(태그 0장일 수도) */
  state: 'analyzing' | 'analyzed' | 'unanalyzed';
  busy: boolean;
  onToggle: (tag: TasteTagValue, enabled: boolean) => void;
  onDelete: () => void;
  onZoom: () => void;
}) {
  return (
    <li className="flex gap-3 rounded-[16px] border border-[color:var(--line)] p-2">
      <button
        type="button"
        onClick={onZoom}
        aria-label="사진 크게 보기"
        className="relative size-16 shrink-0 overflow-hidden rounded-[12px] transition hover:opacity-90"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="size-full object-cover" />
      </button>
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
                  <LuCheck className="size-3" aria-hidden />
                ) : (
                  <LuPlus className="size-3" aria-hidden />
                )}
                {TASTE_TAG_LABELS[tag] ?? tag}
              </button>
            ))}
          </div>
        ) : state === 'analyzing' ? (
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-[color:var(--ink-faint)]">
            <LuLoader className="size-3.5 animate-spin" aria-hidden />
            취향을 분석하고 있어요…
          </p>
        ) : state === 'unanalyzed' ? (
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-[color:var(--danger)]">
            <LuCircleAlert className="size-3.5 shrink-0" aria-hidden />
            분석하지 못한 사진이에요. 아래에서 다시 분석할 수 있어요.
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
        <LuX className="mx-auto size-4" aria-hidden />
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
    <div
      className="mb-3 flex flex-col gap-2 rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card)] p-4 shadow-[var(--shadow-card)]"
      role="status"
    >
      <p className="flex items-center gap-2.5 text-[14px] font-bold tracking-[-0.015em] text-[color:var(--ink)]">
        <span className="inline-flex gap-1" aria-hidden>
          <i className="wvr-scan-dot size-1.5 rounded-full bg-[color:var(--primary)] opacity-40" />
          <i className="wvr-scan-dot size-1.5 rounded-full bg-[color:var(--primary)] opacity-65 [animation-delay:0.2s]" />
          <i className="wvr-scan-dot size-1.5 rounded-full bg-[color:var(--primary)] opacity-95 [animation-delay:0.4s]" />
        </span>
        {queued ? '분석 대기 중이에요' : `취향 분석 중… ${analyzed}/${total}장`}
      </p>
      {/* 대기 중엔 진행률을 알 수 없으므로 목업 .scan-track(좌우로 훑는 띠), 분석이
          시작되면 실제 analyzed/total 진행률 막대로 바꾼다. */}
      {queued ? (
        <span
          className="wvr-scan-track block h-[3px] rounded-full bg-[color:var(--line)]"
          aria-hidden
        />
      ) : (
        <div
          className="h-[3px] w-full overflow-hidden rounded-full bg-[color:var(--line)]"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="취향 분석 진행률"
        >
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${percent}%`,
              background: 'linear-gradient(90deg, var(--t-morning), var(--primary))',
            }}
          />
        </div>
      )}
      <small className="text-[12px] leading-[1.55] text-[color:var(--ink-faint)]">
        사진 한 장에 30초 정도 걸려요. 완료되면 알림으로 알려드릴게요 — 이 페이지를 떠나도 분석은
        계속됩니다.
      </small>
    </div>
  );
}

/** 목업 .tile--ghost — 아직 비어 있는 사진 슬롯(장식용, 클릭 대상 아님). */
function GhostSlot({ slot }: { slot: number }) {
  return (
    <div
      aria-hidden
      className="relative aspect-square rounded-[16px] border-[1.5px] border-dashed border-[color:var(--line-dot)]"
      style={{
        background:
          'radial-gradient(closest-side at 32% 30%, var(--primary-tint), transparent 72%), radial-gradient(closest-side at 72% 76%, var(--accent-tint), transparent 74%), var(--bg)',
      }}
    >
      <span className="absolute bottom-1 right-2 font-mono text-[10.5px] font-semibold tracking-[0.06em] text-[color:var(--ink-faint)] opacity-70">
        {String(slot).padStart(2, '0')}
      </span>
    </div>
  );
}

/** 어떤 사진을 올리면 좋을지 톤으로만 암시하는 빈 상태 스와치(장식용). */
function MoodSwatch({ label, gradient }: { label: string; gradient: string }) {
  return (
    <div
      aria-hidden
      className="relative flex aspect-square items-end overflow-hidden rounded-[16px] opacity-80"
      style={{ background: gradient }}
    >
      <span className="w-full px-2 pb-1.5 text-[10px] font-semibold text-white/90">{label}</span>
    </div>
  );
}

/**
 * 목업 .tag — 분석된 취향 태그 칩. 음식 계열은 sunset 톤(.tag--warm),
 * 무드·환경 계열은 primary 톤으로 갈라 한 덩어리로 뭉치지 않게 한다.
 */
function TasteChip({ label, tone }: { label: string; tone: 'warm' | 'cool' }) {
  return (
    <span
      className={`inline-flex items-baseline rounded-full px-3 py-1.5 text-[13px] font-bold leading-[1.35] tracking-[-0.01em] ${
        tone === 'warm'
          ? 'bg-[color:var(--accent-tint)] text-[color:var(--accent-deep)]'
          : 'bg-[color:var(--primary-tint)] text-[color:var(--primary-deep)]'
      }`}
    >
      {label}
    </span>
  );
}

function SetupBlock({
  title,
  className = '',
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-[20px] border border-[color:var(--line)] bg-[color:var(--card)] p-5 shadow-[var(--shadow-card)] ${className}`}
    >
      <h2 className="mb-3 text-[18px] font-extrabold leading-6 text-[color:var(--ink)]">{title}</h2>
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
        className="mb-1.5 flex justify-between text-[10.5px] text-[color:var(--ink-faint)]"
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
          style={{
            left: `${wakePct}%`,
            background: 'var(--card)',
            borderColor: 'var(--t-morning)',
          }}
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px]"
          style={{ left: `${sleepPct}%`, background: 'var(--card)', borderColor: 'var(--t-dusk)' }}
        />
      </div>
      {/* 목업 .band-times — 각 핸들 아래에 붙는 시각 라벨(읽기 전용, 값은 위 TimeField 가 정본).
          양끝에서 잘리지 않게 위치를 8~92% 로 가둔다. */}
      <div className="relative mt-2.5 h-8" aria-hidden>
        <TimeChip label="기상" time={wakeTime} percent={wakePct} />
        <TimeChip label="취침" time={sleepTime} percent={sleepPct} />
      </div>
      <p className="mt-1 text-[12.5px] text-[color:var(--ink-faint)]">
        일정은 이 리듬 안에서만 짜 드려요.
      </p>
    </div>
  );
}

function TimeChip({ label, time, percent }: { label: string; time: string; percent: number }) {
  return (
    <span
      className="absolute top-0 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-[color:var(--line)] bg-[color:var(--card)] px-2.5 py-1 text-[12px] font-bold text-[color:var(--ink-sub)]"
      style={{ left: `${Math.min(92, Math.max(8, percent))}%` }}
    >
      {label} <span className="font-mono text-[12px] text-[color:var(--ink)]">{time}</span>
    </span>
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
        <span className="shrink-0 text-[14px] font-bold leading-6 text-[color:var(--ink)]">
          {label}
        </span>
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
  const activeClass = like
    ? 'bg-[color:var(--primary)] text-white'
    : 'bg-[color:var(--danger)] text-white';
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
        <LuThumbsUp className="size-3.5" aria-hidden />
      ) : (
        <LuThumbsDown className="size-3.5" aria-hidden />
      )}
    </button>
  );
}

/**
 * 취향 저장·사진 분석은 반드시 내 계정으로 들어가야 한다. 예전에는 세션이 없으면 그 자리에서
 * 임시(공유) 세션을 만들어 붙였는데, 그러면 남의 계정에 내 사진과 취향이 쌓였다. 이 화면은
 * SessionGuard 안에 있어 정상 경로면 세션이 항상 있고, 없으면 조용히 넘어가지 말고 멈춘다.
 */
function requireSession(): Session {
  const session = getStoredSession();
  if (!session) {
    throw new Error('로그인이 만료됐어요. 다시 로그인해주세요.');
  }
  return session;
}
