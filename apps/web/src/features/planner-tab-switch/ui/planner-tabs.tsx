'use client';

export type PlannerTab = 'schedule' | 'map' | 'info' | 'coordination';

const ITEMS: Array<{ value: PlannerTab; label: string }> = [
  { value: 'schedule', label: '일정' },
  { value: 'map', label: '지도' },
  { value: 'info', label: '정보' },
  { value: 'coordination', label: '조율' },
];

type Props = {
  value: PlannerTab;
  onChange: (next: PlannerTab) => void;
};

export function PlannerTabs({ value, onChange }: Props) {
  return (
    <div className="border-b border-[color:var(--line)] bg-[color:var(--card)]">
      <div className="grid grid-cols-4">
        {ITEMS.map((item) => {
          const active = value === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              className={`relative flex h-11 items-center justify-center text-[15px] font-semibold transition ${
                active ? 'text-[color:var(--primary-deep)]' : 'text-[color:var(--ink-faint)]'
              }`}
            >
              {item.label}
              {active ? (
                <span className="app-tabline-in absolute bottom-0 h-[3px] w-16 rounded-full bg-[color:var(--primary)]" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
