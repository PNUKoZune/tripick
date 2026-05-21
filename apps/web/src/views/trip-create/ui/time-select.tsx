'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  label: string;
  value: string;
  onChange: (next: string) => void;
};

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

function snapToStep(value: string): { hour: string; minute: string } {
  const [hRaw, mRaw] = value.split(':');
  const hour = (hRaw ?? '00').padStart(2, '0');
  const minNum = Number(mRaw ?? '0');
  const snapped = MINUTES.reduce((closest, candidate) =>
    Math.abs(Number(candidate) - minNum) < Math.abs(Number(closest) - minNum) ? candidate : closest,
  );
  return { hour, minute: snapped };
}

export function TimeSelect({ label, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const hourColRef = useRef<HTMLDivElement | null>(null);
  const minuteColRef = useRef<HTMLDivElement | null>(null);
  const { hour, minute } = snapToStep(value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    const hourEl = hourColRef.current?.querySelector<HTMLButtonElement>(`[data-hour="${hour}"]`);
    const minuteEl = minuteColRef.current?.querySelector<HTMLButtonElement>(
      `[data-minute="${minute}"]`,
    );
    hourEl?.scrollIntoView({ block: 'center' });
    minuteEl?.scrollIntoView({ block: 'center' });
  }, [open, hour, minute]);

  function update(nextHour: string, nextMinute: string) {
    onChange(`${nextHour}:${nextMinute}`);
  }

  return (
    <div ref={wrapperRef} className="relative flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-[#6B7684]">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={`flex h-12 w-full items-center justify-between rounded-[14px] border bg-white px-4 text-[15px] font-medium text-[#191F28] transition ${
          open ? 'border-[#3182F6] ring-2 ring-[#E1ECFF]' : 'border-[#E5E8EB] hover:bg-[#FAFBFC]'
        }`}
      >
        <span>{`${hour}:${minute}`}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          aria-hidden
          className={`transition ${open ? 'rotate-180 text-[#3182F6]' : 'text-[#8B95A1]'}`}
        >
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-[16px] border border-[#E5E8EB] bg-white shadow-[0_12px_28px_rgba(0,0,0,0.1)]">
          <div className="grid grid-cols-2 gap-0">
            <Column refEl={hourColRef} ariaLabel="시">
              {HOURS.map((h) => {
                const active = h === hour;
                return (
                  <CellButton
                    key={h}
                    data-hour={h}
                    active={active}
                    onClick={() => update(h, minute)}
                  >
                    {h}
                  </CellButton>
                );
              })}
            </Column>
            <Column refEl={minuteColRef} ariaLabel="분" borderLeft>
              {MINUTES.map((m) => {
                const active = m === minute;
                return (
                  <CellButton
                    key={m}
                    data-minute={m}
                    active={active}
                    onClick={() => update(hour, m)}
                  >
                    {m}
                  </CellButton>
                );
              })}
            </Column>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Column({
  refEl,
  ariaLabel,
  borderLeft,
  children,
}: {
  refEl: React.RefObject<HTMLDivElement | null>;
  ariaLabel: string;
  borderLeft?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={refEl}
      role="listbox"
      aria-label={ariaLabel}
      className={`max-h-[200px] overflow-y-auto py-1 ${borderLeft ? 'border-l border-[#E5E8EB]' : ''}`}
    >
      {children}
    </div>
  );
}

function CellButton({
  active,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`flex h-9 w-full items-center justify-center text-[14px] font-semibold transition ${
        active
          ? 'bg-[#EAF2FF] text-[#1B64DA]'
          : 'text-[#191F28] hover:bg-[#F7F8FA]'
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}
