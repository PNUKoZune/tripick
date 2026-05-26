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
    <div className="border-b border-[#E5E8EB] bg-white">
      <div className="grid grid-cols-4">
        {ITEMS.map((item) => {
          const active = value === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              className={`relative flex h-11 items-center justify-center text-[15px] font-semibold transition ${
                active ? 'text-[#1B64DA]' : 'text-[#8B95A1]'
              }`}
            >
              {item.label}
              {active ? (
                <span className="absolute bottom-0 h-[3px] w-16 rounded-full bg-[#3182F6]" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
