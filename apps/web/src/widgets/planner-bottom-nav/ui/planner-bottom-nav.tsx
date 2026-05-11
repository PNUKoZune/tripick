'use client';

const ITEMS = [
  { id: 'home', label: '홈', icon: '🏠' },
  { id: 'map', label: '지도', icon: '🗺' },
  { id: 'trips', label: '내 여행', icon: '🧳' },
  { id: 'profile', label: '프로필', icon: '👤' },
] as const;

type Props = {
  active?: (typeof ITEMS)[number]['id'];
};

export function PlannerBottomNav({ active = 'trips' }: Props) {
  return (
    <nav className="sticky bottom-0 z-30 border-t border-[#E5E8EB] bg-white">
      <ul className="grid grid-cols-4">
        {ITEMS.map((item) => {
          const isActive = item.id === active;
          return (
            <li key={item.id} className="relative">
              <button
                type="button"
                className={`flex w-full flex-col items-center gap-1 py-2.5 text-[12px] font-semibold ${
                  isActive ? 'text-[#1B64DA]' : 'text-[#8B95A1]'
                }`}
              >
                <span aria-hidden className="text-[18px]">
                  {item.icon}
                </span>
                {item.label}
                {isActive ? (
                  <span className="absolute bottom-0 h-[3px] w-12 rounded-full bg-[#3182F6]" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
