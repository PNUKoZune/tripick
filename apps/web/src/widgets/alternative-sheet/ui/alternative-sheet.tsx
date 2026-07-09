'use client';

import { useEffect, useState } from 'react';
import type { PlannerItineraryItemDto } from '@tripick/types';

import { AlternativeCard } from '@/entities/alternative';
import { useAlternativeController } from '@/features/select-alternative';
import { BottomSheet, Button, Chip } from '@/shared/ui';
import { PlannerMap } from '@/widgets/planner-map';

type Props = {
  tripId: string;
  open: boolean;
  item: PlannerItineraryItemDto | null;
  onClose: () => void;
  onApplied: (newName: string, itemId: string) => void;
};

export function AlternativeSheet({ tripId, open, item, onClose, onApplied }: Props) {
  const controller = useAlternativeController(tripId, open ? item?.id ?? null : null);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [requestText, setRequestText] = useState('');
  const [linkText, setLinkText] = useState('');

  // 시트를 새로 열 때마다 입력 초기화
  useEffect(() => {
    if (open) {
      setKeepOriginal(false);
      setRequestText('');
      setLinkText('');
    }
  }, [open, item?.id]);

  const readyData = controller.state.status === 'ready' ? controller.state.data : null;

  const topSlot = (
    <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#F2F4F6]">
      {readyData ? (
        <div className="absolute inset-0">
          <PlannerMap
            placeholder="대안 위치 확인"
            center={readyData.mapCenter}
            markers={readyData.mapMarkers}
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
    <BottomSheet open={open} onClose={onClose} topSlot={topSlot}>
      <div className="min-h-[420px]">
        {controller.state.status === 'loading' || controller.state.status === 'idle' ? (
          <SkeletonBody />
        ) : null}

        {controller.state.status === 'error' ? (
          <div className="rounded-[16px] border border-[#FECDD3] bg-[#FFECEE] p-4 text-[14px] text-[#F04452]">
            {controller.state.message}
          </div>
        ) : null}

        {controller.state.status === 'ready' ? (
          <>
            <div className="flex items-start gap-3">
              <div className="flex size-9 items-center justify-center rounded-[10px] bg-[#FFECEE] text-[18px] font-bold text-[#F04452]">
                !
              </div>
              <div className="flex-1">
                <div className="text-[18px] font-bold leading-[26px] text-[#191F28]">
                  {controller.state.data.waitingMinutes > 0 ? '웨이팅이 길어요' : '비슷한 다른 장소'}
                </div>
                <div className="mt-1 text-[14px] leading-[20px] text-[#6B7684]">
                  {controller.state.data.itemName}
                  {controller.state.data.waitingMinutes > 0
                    ? ` 현재 예상 대기: 약 ${controller.state.data.waitingMinutes}분`
                    : ' 주변에서 골라볼 수 있어요'}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Chip tone="primary" size="md">
                카카오맵 기준 반경 {controller.state.data.radiusMeters}m 내
              </Chip>
              {controller.state.data.realtime ? <Chip tone="success">실시간 반영</Chip> : null}
            </div>

            {/* 사용자 직접 요청: 자유 텍스트 + 지도 링크 */}
            <div className="mt-5 space-y-3 rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC] p-4">
              <div className="text-[13px] font-bold text-[#4E5968]">
                원하는 곳이 없나요? 직접 요청해보세요
              </div>

              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  controller.submitSearch(requestText);
                }}
              >
                <input
                  value={requestText}
                  onChange={(e) => setRequestText(e.target.value)}
                  placeholder="예: 조용한 감성 카페 추천해줘"
                  className="h-11 flex-1 rounded-[12px] border border-[#E5E8EB] bg-white px-3 text-[14px] text-[#191F28] outline-none placeholder:text-[#B0B8C1] focus:border-[#3182F6]"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  className="h-11 shrink-0 px-4 text-[14px]"
                  disabled={controller.searching || !requestText.trim()}
                >
                  {controller.searching ? '검색 중…' : '검색'}
                </Button>
              </form>

              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void controller.resolveLink(linkText).then((ok) => {
                    if (ok) setLinkText('');
                  });
                }}
              >
                <input
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  placeholder="네이버/카카오 지도 링크 붙여넣기"
                  className="h-11 flex-1 rounded-[12px] border border-[#E5E8EB] bg-white px-3 text-[14px] text-[#191F28] outline-none placeholder:text-[#B0B8C1] focus:border-[#3182F6]"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  className="h-11 shrink-0 px-4 text-[14px]"
                  disabled={controller.resolving || !linkText.trim()}
                >
                  {controller.resolving ? '불러오는 중…' : '불러오기'}
                </Button>
              </form>

              {controller.resolveError ? (
                <div className="text-[12px] text-[#F04452]">{controller.resolveError}</div>
              ) : null}
              {controller.query ? (
                <div className="text-[12px] text-[#6B7684]">
                  ‘{controller.query}’ 요청 결과를 보여드려요.
                </div>
              ) : null}
            </div>

            <div className="mt-5 border-t border-[#E5E8EB] pt-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[16px] font-bold leading-[22px] text-[#191F28]">
                  {controller.query ? '요청 반영 결과' : 'AI 추천 대안'}
                </h2>
                <span className="text-[12px] font-semibold text-[#8B95A1]">
                  {controller.alternatives.length}곳
                </span>
              </div>

              {controller.alternatives.length === 0 ? (
                <div className="mt-3 rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC] p-4 text-center text-[13px] text-[#6B7684]">
                  {controller.query
                    ? '요청에 맞는 장소를 찾지 못했어요. 다른 표현으로 시도해보세요.'
                    : '추천할 대안을 찾지 못했어요.'}
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {controller.alternatives.map((alt) => (
                    <AlternativeCard
                      key={alt.id}
                      alternative={alt}
                      selected={controller.selectedId === alt.id && !keepOriginal}
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
                disabled={controller.submitting || !controller.selectedId}
                onClick={async () => {
                  if (!item) return;
                  const result = await controller.apply();
                  if (result) {
                    onApplied(result.newItemName, item.id);
                    onClose();
                  }
                }}
              >
                {controller.submitting ? '변경 중…' : '이 장소로 변경'}
              </Button>
            </div>

            {controller.appliedName ? (
              <div className="mt-3 text-center text-[13px] text-[#00A86B]">
                {controller.appliedName}(으)로 변경됐어요.
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </BottomSheet>
  );
}

function SkeletonMap() {
  return (
    <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-[#EEF2F4] to-[#E5E8EB]" />
  );
}

function SkeletonBody() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-start gap-3">
        <div className="size-9 rounded-[10px] bg-[#F2F4F6]" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-2/3 rounded bg-[#F2F4F6]" />
          <div className="h-4 w-1/2 rounded bg-[#F2F4F6]" />
        </div>
      </div>
      <div className="h-7 w-44 rounded-full bg-[#F2F4F6]" />
      <div className="h-px bg-[#E5E8EB]" />
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[84px] rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC]" />
        ))}
      </div>
    </div>
  );
}
