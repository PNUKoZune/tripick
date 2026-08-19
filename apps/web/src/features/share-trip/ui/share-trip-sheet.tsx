'use client';

import { useRef, useState } from 'react';
import { LuCheck, LuCopy, LuDownload, LuFileText, LuImage, LuLink, LuShare2 } from 'react-icons/lu';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlannerDayDto, PlannerItineraryItemDto } from '@tripick/types';

import { disableTripShare, enableTripShare, fetchTripShareStatus } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';
import { BottomSheet, Button } from '@/shared/ui';

import { downloadNodeAsPdf, downloadNodeAsPng } from '../lib/export-node';
import { ShareableItinerary } from './shareable-itinerary';

type Props = {
  open: boolean;
  onClose: () => void;
  tripId: string;
  tripTitle: string;
  subtitle: string;
  days: PlannerDayDto[];
  items: PlannerItineraryItemDto[];
  /** 공유 링크 생성 권한 (owner). false 면 링크 섹션을 숨기고 저장만 노출 */
  canShareLink?: boolean;
};

export function ShareTripSheet({
  open,
  onClose,
  tripId,
  tripTitle,
  subtitle,
  days,
  items,
  canShareLink = true,
}: Props) {
  const queryClient = useQueryClient();
  const cardRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState<'png' | 'pdf' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: queryKeys.planner.share(tripId),
    queryFn: () => fetchTripShareStatus(tripId),
    enabled: open && Boolean(tripId),
    staleTime: 60 * 1000,
  });

  const enableMutation = useMutation({
    mutationFn: () => enableTripShare(tripId),
    onSuccess: (res) => queryClient.setQueryData(queryKeys.planner.share(tripId), res),
  });
  const disableMutation = useMutation({
    mutationFn: () => disableTripShare(tripId),
    onSuccess: () => queryClient.setQueryData(queryKeys.planner.share(tripId), { token: null }),
  });

  const token = statusQuery.data?.token ?? null;
  const shareUrl =
    token && typeof window !== 'undefined' ? `${window.location.origin}/share/${token}` : '';

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function nativeShare() {
    if (!shareUrl || typeof navigator.share !== 'function') {
      void copyLink();
      return;
    }
    try {
      await navigator.share({ title: tripTitle, text: `${tripTitle} 여행 일정`, url: shareUrl });
    } catch {
      /* 사용자가 취소하면 무시 */
    }
  }

  async function handleExport(kind: 'png' | 'pdf') {
    if (!cardRef.current) return;
    setExporting(kind);
    setExportError(null);
    try {
      const safeName = tripTitle.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || '여행일정';
      if (kind === 'png') {
        await downloadNodeAsPng(cardRef.current, `${safeName}.png`);
      } else {
        await downloadNodeAsPdf(cardRef.current, `${safeName}.pdf`);
      }
    } catch {
      setExportError('저장에 실패했어요. 다시 시도해 주세요.');
    } finally {
      setExporting(null);
    }
  }

  const canShareNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <BottomSheet open={open} onClose={onClose} label="일정 공유" themed>
      <div className="px-5 pb-6 pt-2">
        <h2 className="text-[18px] font-bold text-[color:var(--ink,#191F28)]">일정 공유</h2>
        <p className="mt-1 text-[13px] text-[color:var(--ink-faint,#8B95A1)]">
          링크로 공유하거나 이미지·PDF 로 저장할 수 있어요.
        </p>

        {/* 링크 공유 (owner 만) */}
        {canShareLink ? (
          <section className="mt-4 rounded-[16px] border border-[color:var(--line,#E5E8EB)] p-4">
            <div className="flex items-center gap-2">
              <LuLink className="size-4 text-[color:var(--primary,#3182F6)]" />
              <h3 className="text-[14px] font-bold text-[color:var(--ink,#191F28)]">링크 공유</h3>
            </div>

            {token ? (
              <>
                <div className="mt-3 flex items-center gap-2 rounded-[12px] bg-[color:var(--card-soft,#F7F8FA)] px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[color:var(--ink-sub,#4E5968)]">
                    {shareUrl}
                  </span>
                  <button
                    type="button"
                    onClick={copyLink}
                    className="flex h-8 shrink-0 items-center gap-1 rounded-[8px] bg-[color:var(--card,#fff)] px-2.5 text-[12px] font-bold text-[color:var(--primary,#3182F6)] shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                  >
                    {copied ? <LuCheck className="size-3.5" /> : <LuCopy className="size-3.5" />}
                    {copied ? '복사됨' : '복사'}
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {canShareNative ? (
                    <Button variant="primary" size="md" className="flex-1" onClick={nativeShare}>
                      <span className="flex items-center gap-1.5">
                        <LuShare2 className="size-4" />
                        공유하기
                      </span>
                    </Button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => disableMutation.mutate()}
                    disabled={disableMutation.isPending}
                    className="h-10 rounded-[12px] px-3 text-[13px] font-semibold text-[color:var(--danger,#F04452)] hover:bg-[color:var(--danger-tint,#FFECEE)] disabled:opacity-50"
                  >
                    공유 중지
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-[color:var(--ink-faint,#B0B8C1)]">
                  링크가 있는 누구나 이 일정을 볼 수 있어요.
                </p>
              </>
            ) : (
              <Button
                variant="secondary"
                size="md"
                className="mt-3 w-full"
                disabled={enableMutation.isPending || statusQuery.isLoading}
                onClick={() => enableMutation.mutate()}
              >
                {enableMutation.isPending ? '만드는 중…' : '공유 링크 만들기'}
              </Button>
            )}
          </section>
        ) : null}

        {/* 저장 */}
        <section className="mt-3 rounded-[16px] border border-[color:var(--line,#E5E8EB)] p-4">
          <div className="flex items-center gap-2">
            <LuDownload className="size-4 text-[color:var(--primary,#3182F6)]" />
            <h3 className="text-[14px] font-bold text-[color:var(--ink,#191F28)]">
              이미지 · PDF 저장
            </h3>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              className="flex-1"
              disabled={exporting !== null}
              onClick={() => handleExport('png')}
            >
              <span className="flex items-center gap-1.5">
                <LuImage className="size-4" />
                {exporting === 'png' ? '저장 중…' : '이미지'}
              </span>
            </Button>
            <Button
              variant="secondary"
              size="md"
              className="flex-1"
              disabled={exporting !== null}
              onClick={() => handleExport('pdf')}
            >
              <span className="flex items-center gap-1.5">
                <LuFileText className="size-4" />
                {exporting === 'pdf' ? '저장 중…' : 'PDF'}
              </span>
            </Button>
          </div>
          {exportError ? (
            <p className="mt-2 text-[12px] text-[color:var(--danger,#F04452)]">{exportError}</p>
          ) : null}
        </section>
      </div>

      {/* 내보내기용 오프스크린 카드 (캡처 대상) */}
      <div aria-hidden style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
        <ShareableItinerary
          ref={cardRef}
          title={tripTitle}
          subtitle={subtitle}
          days={days}
          items={items}
        />
      </div>
    </BottomSheet>
  );
}
