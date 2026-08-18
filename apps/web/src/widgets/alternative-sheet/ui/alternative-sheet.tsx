'use client';

import { useEffect, useState } from 'react';
import type {
  PlannerItineraryItemDto,
  PlannerMapCenterDto,
  PlannerSwapPlaceDto,
  PlannerSwapResponseDto,
} from '@tripick/types';

import { AlternativeCard } from '@/entities/alternative';
import { useAlternativeController } from '@/features/select-alternative';
import { BottomSheet, Button, Chip } from '@/shared/ui';
import { PlannerMap, normalizeMarkerPositions } from '@/widgets/planner-map';

const FALLBACK_CENTER: PlannerMapCenterDto = { lat: 37.5665, lng: 126.978, level: 5 };

type Props = {
  tripId: string;
  open: boolean;
  item: PlannerItineraryItemDto | null;
  onClose: () => void;
  onApplied: (newName: string, itemId: string) => void;
  /** owner 면 즉시 반영, 아니면 owner 승인 대기 제안으로 보낸다 */
  isOwner?: boolean;
  /** 비-owner 제안 성공 시 요약 전달(토스트용) */
  onProposed?: (summary: string) => void;
};

export function AlternativeSheet({
  tripId,
  open,
  item,
  onClose,
  onApplied,
  isOwner = true,
  onProposed,
}: Props) {
  const controller = useAlternativeController(tripId, open ? (item?.id ?? null) : null, {
    isOwner,
    ...(onProposed ? { onProposed } : {}),
  });
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [requestText, setRequestText] = useState('');
  const [placeName, setPlaceName] = useState('');
  // swap 반영 결과 (변경명·되돌리기용 이전 장소·경고)
  const [swapResult, setSwapResult] = useState<{
    newName: string;
    previousPlace: PlannerSwapPlaceDto;
    warnings: string[];
  } | null>(null);

  // 시트를 새로 열 때마다 입력 초기화
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 시트가 열릴 때 입력 초기화
      setKeepOriginal(false);
      setRequestText('');
      setPlaceName('');
      setSwapResult(null);
    }
  }, [open, item?.id]);

  // 경고 없는 변경은 되돌리기 여유를 두고 5초 뒤 자동으로 닫는다
  useEffect(() => {
    if (!swapResult || swapResult.warnings.length > 0) return;
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [swapResult, onClose]);

  async function handleUndo() {
    if (!swapResult || !item) return;
    // 되돌리기는 swapResult 가 있는 owner 모드에서만 노출되므로 즉시 반영 결과다.
    const result = (await controller.swapToPlace(
      swapResult.previousPlace,
    )) as PlannerSwapResponseDto | null;
    if (result) {
      onApplied(result.newItemName, item.id);
      onClose();
    }
  }

  const readyData = controller.state.status === 'ready' ? controller.state.data : null;
  const { pending, pendingSelectedId, selectedId } = controller;

  // 지도: 확인 대기 후보 > 선택한 대안 순으로 초점을 맞춘다.
  // base(추천)와 pending(장소 검색) 마커는 서버에서 각자 정규화돼 오므로, 병합 후
  // 폴백 좌표를 최종 집합 기준으로 다시 정규화해 SDK 미로딩 미리보기 위치를 맞춘다.
  const baseMarkers = readyData?.mapMarkers ?? [];
  const mapMarkers = pending
    ? normalizeMarkerPositions([...baseMarkers, ...pending.markers])
    : baseMarkers;
  const activeMarkerId = pending
    ? pendingSelectedId
      ? `marker-${pendingSelectedId}`
      : (pending.markers[0]?.id ?? null)
    : selectedId
      ? `marker-${selectedId}`
      : null;
  const activeMarker = mapMarkers.find((m) => m.id === activeMarkerId) ?? null;
  const mapCenter: PlannerMapCenterDto = activeMarker
    ? { lat: activeMarker.lat, lng: activeMarker.lng, level: 4 }
    : (readyData?.mapCenter ?? FALLBACK_CENTER);

  const topSlot = (
    <div className="relative aspect-[16/9] w-full overflow-hidden bg-[color:var(--card-soft,#F2F4F6)]">
      {readyData ? (
        <div className="absolute inset-0">
          <PlannerMap
            placeholder="대안 위치 확인"
            center={mapCenter}
            markers={mapMarkers}
            selectedMarkerId={activeMarkerId}
            showCurrentDot={false}
            aspect="aspect-[16/9]"
            showSearch={false}
          />
        </div>
      ) : (
        <SkeletonMap />
      )}
    </div>
  );

  return (
    <BottomSheet open={open} onClose={onClose} topSlot={topSlot} label="AI 추천 대안" themed>
      <div className="min-h-[420px]">
        {controller.state.status === 'loading' || controller.state.status === 'idle' ? (
          <SkeletonBody />
        ) : null}

        {controller.state.status === 'error' ? (
          <div className="rounded-[16px] border border-[color:var(--danger-border,#FECDD3)] bg-[color:var(--danger-tint,#FFECEE)] p-4 text-[14px] text-[color:var(--danger,#F04452)]">
            {controller.state.message}
          </div>
        ) : null}

        {readyData ? (
          <>
            <div className="flex items-start gap-3">
              <div className="flex size-9 items-center justify-center rounded-[10px] bg-[color:var(--danger-tint,#FFECEE)] text-[18px] font-bold text-[color:var(--danger,#F04452)]">
                !
              </div>
              <div className="flex-1">
                <div className="text-[18px] font-bold leading-[26px] text-[color:var(--ink)]">
                  비슷한 다른 장소
                </div>
                <div className="mt-1 text-[14px] leading-[20px] text-[color:var(--ink-sub)]">
                  {readyData.itemName} 주변에서 골라볼 수 있어요
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Chip tone="primary" size="md">
                취향 기반 추천
              </Chip>
              {readyData.realtime ? <Chip tone="success">실데이터</Chip> : null}
            </div>

            {controller.isProposalMode ? (
              <p className="mt-3 rounded-[12px] border border-[color:var(--primary)]/30 bg-[color:var(--primary-tint)] px-3 py-2 text-[12px] leading-[18px] text-[color:var(--primary-deep)]">
                대안 변경은 여행 관리자 승인 후 반영돼요. 변경 요청 시 관리자에게 알림이 전송됩니다.
              </p>
            ) : null}

            {swapResult ? (
              <div
                className={`mt-4 rounded-[16px] border p-4 ${
                  swapResult.warnings.length > 0
                    ? 'border-[color:var(--accent)]/40 bg-[color:var(--accent-tint)]'
                    : 'border-[color:var(--primary)]/30 bg-[color:var(--primary-tint)]'
                }`}
              >
                {swapResult.warnings.length > 0 ? (
                  <>
                    <div className="text-[13px] font-bold text-[color:var(--accent-deep)]">
                      변경했지만 확인이 필요해요
                    </div>
                    <ul className="mt-1.5 space-y-1 text-[13px] leading-[18px] text-[color:var(--ink-sub)]">
                      {swapResult.warnings.map((w) => (
                        <li key={w}>· {w}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="text-[14px] font-bold text-[color:var(--primary-deep)]">
                    ‘{swapResult.newName}’(으)로 변경했어요.
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="secondary"
                    fullWidth
                    disabled={controller.submitting}
                    onClick={handleUndo}
                  >
                    되돌리기
                  </Button>
                  <Button variant="primary" fullWidth onClick={onClose}>
                    확인
                  </Button>
                </div>
              </div>
            ) : null}

            {/* 사용자 직접 요청: 자유 텍스트 AI 재계획 + 장소 이름 지정 */}
            <div className="mt-5 space-y-3 rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card-soft)] p-4">
              <div className="text-[13px] font-bold text-[color:var(--ink-sub)]">
                원하는 곳이 없나요? 직접 요청해보세요
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  controller.refine(requestText);
                }}
              >
                <div className="flex gap-2">
                  <input
                    value={requestText}
                    onChange={(e) => setRequestText(e.target.value)}
                    placeholder="예: 조용한 감성 카페 위주로"
                    className="h-11 min-w-0 flex-1 rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-3 text-[14px] text-[color:var(--ink)] outline-none placeholder:text-[color:var(--ink-faint)] focus:border-[color:var(--primary)]"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    className="h-11 shrink-0 px-4 text-[14px]"
                    disabled={controller.refining || !requestText.trim()}
                  >
                    {controller.refining ? '찾는 중…' : 'AI 추천'}
                  </Button>
                </div>
                <div className="mt-1.5 text-[12px] text-[color:var(--ink-faint)]">
                  조건을 반영해 이 일정의 대안을 다시 찾아드려요.
                </div>
              </form>

              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void controller.searchPlace(placeName);
                }}
              >
                <input
                  value={placeName}
                  onChange={(e) => setPlaceName(e.target.value)}
                  placeholder="가고 싶은 장소 이름 입력 (예: 성수 대림창고)"
                  className="h-11 min-w-0 flex-1 rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-3 text-[14px] text-[color:var(--ink)] outline-none placeholder:text-[color:var(--ink-faint)] focus:border-[color:var(--primary)]"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  className="h-11 shrink-0 px-4 text-[14px]"
                  disabled={controller.searchingPlace || !placeName.trim()}
                >
                  {controller.searchingPlace ? '찾는 중…' : '찾기'}
                </Button>
              </form>

              {controller.searchPlaceError ? (
                <div className="text-[12px] text-[color:var(--danger,#F04452)]">
                  {controller.searchPlaceError}
                </div>
              ) : null}
            </div>

            {/* 장소 이름 검색 결과 — 후보 중 맞는 곳 선택 */}
            {pending ? (
              <div className="mt-4 rounded-[16px] border border-[color:var(--primary)] bg-[color:var(--primary-tint)] p-4">
                <div className="text-[13px] font-bold text-[color:var(--primary-deep)]">
                  {pending.alternatives.length > 1
                    ? '이 중 맞는 곳을 골라주세요'
                    : '이 장소가 맞나요?'}
                </div>
                <div className="mt-2 space-y-2">
                  {pending.alternatives.map((alt) => (
                    <AlternativeCard
                      key={alt.id}
                      alternative={alt}
                      selected={pendingSelectedId === alt.id}
                      onSelect={() => controller.setPendingSelectedId(alt.id)}
                    />
                  ))}
                </div>
                <div className="mt-1.5 text-[12px] text-[color:var(--ink-faint)]">
                  위쪽 지도에서 위치를 확인해보세요.
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="secondary"
                    className="h-10 flex-1 text-[14px]"
                    onClick={controller.cancelPending}
                  >
                    취소
                  </Button>
                  <Button
                    variant="primary"
                    className="h-10 flex-1 text-[14px]"
                    disabled={controller.submitting || !pendingSelectedId}
                    onClick={async () => {
                      if (!item) return;
                      const result = await controller.confirmPending();
                      if (!result) return;
                      if (controller.isProposalMode) {
                        onClose();
                        return;
                      }
                      const swap = result as PlannerSwapResponseDto;
                      onApplied(swap.newItemName, item.id);
                      setSwapResult({
                        newName: swap.newItemName,
                        previousPlace: swap.previousPlace,
                        warnings: swap.warnings ?? [],
                      });
                    }}
                  >
                    {controller.submitting
                      ? '처리 중…'
                      : controller.isProposalMode
                        ? '이 장소로 변경 요청'
                        : '이 장소로 변경'}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-5 border-t border-[color:var(--line)] pt-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[16px] font-bold leading-[22px] text-[color:var(--ink)]">
                  {controller.note ? '조건 반영 결과' : 'AI 추천 대안'}
                </h2>
                <span className="text-[12px] font-semibold text-[color:var(--ink-faint)]">
                  {controller.alternatives.length}곳
                </span>
              </div>

              {controller.note ? (
                <button
                  type="button"
                  onClick={() => {
                    setRequestText('');
                    controller.clearRefine();
                  }}
                  className="mt-1 text-[12px] font-semibold text-[color:var(--primary)]"
                >
                  ‘{controller.note}’ 반영 중 · 기본 추천으로 되돌리기
                </button>
              ) : null}

              {controller.alternatives.length === 0 ? (
                <div className="mt-3 rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card-soft)] p-4 text-center text-[13px] text-[color:var(--ink-sub)]">
                  {controller.note
                    ? '조건에 맞는 장소를 찾지 못했어요. 다른 표현으로 시도해보세요.'
                    : '추천할 대안을 찾지 못했어요.'}
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {controller.alternatives.map((alt) => (
                    <AlternativeCard
                      key={alt.id}
                      alternative={alt}
                      selected={selectedId === alt.id && !keepOriginal}
                      onSelect={() => {
                        controller.setSelectedId(alt.id);
                        setKeepOriginal(false);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 flex gap-3">
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  setKeepOriginal(true);
                  onClose();
                }}
              >
                원래 일정 유지
              </Button>
              <Button
                variant="primary"
                fullWidth
                disabled={controller.submitting || !selectedId}
                onClick={async () => {
                  if (!item) return;
                  const result = await controller.apply();
                  if (!result) return;
                  if (controller.isProposalMode) {
                    onClose();
                    return;
                  }
                  const swap = result as PlannerSwapResponseDto;
                  onApplied(swap.newItemName, item.id);
                  setSwapResult({
                    newName: swap.newItemName,
                    previousPlace: swap.previousPlace,
                    warnings: swap.warnings ?? [],
                  });
                }}
              >
                {controller.submitting
                  ? '처리 중…'
                  : controller.isProposalMode
                    ? '이 장소로 변경 요청'
                    : '이 장소로 변경'}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </BottomSheet>
  );
}

function SkeletonMap() {
  return (
    <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-[color:var(--card-soft,#EEF2F4)] to-[color:var(--line,#E5E8EB)]" />
  );
}

function SkeletonBody() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-start gap-3">
        <div className="size-9 rounded-[10px] bg-[color:var(--card-soft,#F2F4F6)]" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-2/3 rounded bg-[color:var(--card-soft,#F2F4F6)]" />
          <div className="h-4 w-1/2 rounded bg-[color:var(--card-soft,#F2F4F6)]" />
        </div>
      </div>
      <div className="h-7 w-44 rounded-full bg-[color:var(--card-soft,#F2F4F6)]" />
      <div className="h-px bg-[color:var(--line,#E5E8EB)]" />
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[84px] rounded-[16px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card-soft,#FAFBFC)]"
          />
        ))}
      </div>
    </div>
  );
}
