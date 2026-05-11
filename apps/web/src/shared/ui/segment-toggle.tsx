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
};

export function SegmentToggle({ items, value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`flex h-12 items-center justify-center gap-2 rounded-[14px] border text-[15px] font-semibold transition ${
              active
                ? 'border-[#3182F6] bg-[#EAF2FF] text-[#1B64DA]'
                : 'border-[#E5E8EB] bg-white text-[#6B7684] hover:bg-[#F2F4F6]'
            }`}
          >
            <span>{item.label}</span>
            {item.helper ? (
              <span className={`text-[13px] font-medium ${active ? 'text-[#1B64DA]' : 'text-[#8B95A1]'}`}>
                {item.helper}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
