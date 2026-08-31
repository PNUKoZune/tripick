'use client';

import { LuMonitor, LuMoon, LuSun } from 'react-icons/lu';
import type { IconType } from 'react-icons';

import { useTheme, type ThemePreference } from '@/shared/theme';
import { SegmentToggle } from '@/shared/ui';

const OPTIONS: { value: ThemePreference; label: string; icon: IconType }[] = [
  { value: 'system', label: '시스템', icon: LuMonitor },
  { value: 'light', label: '라이트', icon: LuSun },
  { value: 'dark', label: '다크', icon: LuMoon },
];

/** 설정 페이지의 화면 테마 선택. 저장·적용은 ThemeProvider 가 맡는다. */
export function ThemeSwitch() {
  const { preference, setPreference } = useTheme();

  return (
    <SegmentToggle
      columns={3}
      value={preference}
      onChange={(next) => setPreference(next as ThemePreference)}
      items={OPTIONS.map(({ value, label, icon: Icon }) => ({
        value,
        label: (
          <span className="flex items-center gap-1.5">
            <Icon className="size-4" aria-hidden />
            {label}
          </span>
        ),
      }))}
    />
  );
}
