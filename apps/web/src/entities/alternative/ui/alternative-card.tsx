'use client';

import { LuClock, LuSparkles } from 'react-icons/lu';
import type { PlannerAlternativeDto } from '@tripick/types';

import { Button, Chip } from '@/shared/ui';

const toneToBg: Record<PlannerAlternativeDto['categoryTone'], string> = {
  neutral: 'bg-[color:var(--card-soft,#F2F4F6)] text-[color:var(--ink-sub,#6B7684)]',
  primary: 'bg-[color:var(--primary-tint,#EAF2FF)] text-[color:var(--primary-deep,#1B64DA)]',
  success: 'bg-[#E5F7EE] text-[#00A86B]',
};

const badgeToneMap: Record<PlannerAlternativeDto['badgeTone'], 'warning' | 'primary' | 'success'> =
  {
    urgent: 'warning',
    recommend: 'primary',
    local: 'success',
  };

type Props = {
  alternative: PlannerAlternativeDto;
  selected?: boolean;
  onSelect: () => void;
};

export function AlternativeCard({ alternative, selected, onSelect }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer rounded-[16px] border p-3 transition ${
        selected
          ? 'border-[color:var(--primary,#3182F6)] bg-[color:var(--primary-tint,#EAF2FF)]'
          : 'border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#FFFFFF)] hover:border-[color:var(--primary,#3182F6)]/40'
      }`}
    >
      <div className="flex items-stretch gap-3">
        <div
          className={`flex size-[62px] shrink-0 items-center justify-center rounded-[14px] text-[22px] font-bold ${toneToBg[alternative.categoryTone]}`}
        >
          {alternative.categoryEmoji}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[15px] font-semibold leading-[22px] text-[color:var(--ink,#191F28)]">
                  {alternative.name}
                </span>
                {alternative.realPlace ? (
                  <span className="shrink-0 rounded-full bg-[#E5F7EE] px-1.5 py-0.5 text-[10px] font-bold text-[#00A86B]">
                    실제 장소
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-[13px] leading-[18px] text-[color:var(--ink-sub,#6B7684)]">
                {alternative.walkLabel} · {alternative.waitLabel}
              </div>
              {alternative.reason ? (
                <div className="mt-1 flex items-start gap-1 text-[12px] leading-[16px] text-[color:var(--primary-deep,#1B64DA)]">
                  <LuSparkles className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span className="line-clamp-2">{alternative.reason}</span>
                </div>
              ) : null}
              {alternative.closedAtScheduled ? (
                <div className="mt-1 flex items-center gap-1 text-[12px] leading-[16px] text-[color:var(--accent-deep,#B45309)]">
                  <LuClock className="size-3 shrink-0" aria-hidden />
                  <span>
                    방문 시간대 영업 종료
                    {alternative.openingHours ? ` · ${alternative.openingHours}` : ''}
                  </span>
                </div>
              ) : null}
              {alternative.address ? (
                <div className="mt-0.5 truncate text-[12px] leading-[16px] text-[color:var(--ink-faint,#8B95A1)]">
                  {alternative.address}
                </div>
              ) : null}
            </div>
            <Chip tone={badgeToneMap[alternative.badgeTone]}>{alternative.badge}</Chip>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[13px] leading-[18px] text-[color:var(--ink-sub,#6B7684)]">
              {alternative.rating !== undefined ? (
                <>
                  <span className="text-[#FF8A00]">★</span>
                  <span>{alternative.rating.toFixed(1)}</span>
                </>
              ) : null}
              <a
                href={alternative.mapHref}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded-full border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card-soft,#FAFBFC)] px-2 py-1 text-[12px] font-semibold text-[color:var(--ink-sub,#6B7684)]"
              >
                카카오맵 보기
              </a>
            </div>
            <Button
              size="md"
              variant={selected ? 'primary' : 'secondary'}
              onClick={onSelect}
              className="h-9 px-3 text-[13px]"
            >
              {selected ? '선택됨' : '선택'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
