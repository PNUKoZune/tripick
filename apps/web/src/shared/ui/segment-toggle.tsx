'use client';

import type { ReactNode } from 'react';

type Item = {
  value: string;
  label: ReactNode;
  helper?: ReactNode;
};

type Props = {
  items: Item[];
  value: string;
  onChange: (next: string) => void;
  /** 열 개수 (기본 2). 옵션이 3개면 3으로 주면 균등 배치된다. */
  columns?: 2 | 3;
};

export function SegmentToggle({ items, value, onChange, columns = 2 }: Props) {
  const gridClass = columns === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div className={`grid ${gridClass} gap-2`}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`flex h-12 items-center justify-center gap-2 rounded-[12px] border text-[15px] font-semibold transition ${
              active
                ? 'border-[color:var(--primary,#3182F6)] bg-[color:var(--primary-tint,#EAF2FF)] text-[color:var(--primary-deep,#1B64DA)]'
                : 'border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#FFFFFF)] text-[color:var(--ink-sub,#6B7684)] hover:bg-[color:var(--card-soft,#F2F4F6)]'
            }`}
          >
            <span>{item.label}</span>
            {item.helper ? (
              <span
                className={`text-[13px] font-medium ${
                  active
                    ? 'text-[color:var(--primary-deep,#1B64DA)]'
                    : 'text-[color:var(--ink-faint,#8B95A1)]'
                }`}
              >
                {item.helper}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
