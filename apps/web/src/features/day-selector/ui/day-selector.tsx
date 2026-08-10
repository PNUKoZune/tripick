'use client';

import type { PlannerDayDto } from '@tripick/types';

import { SegmentToggle } from '@/shared/ui';

type Props = {
  days: PlannerDayDto[];
  value: number;
  onChange: (day: number) => void;
};

export function DaySelector({ days, value, onChange }: Props) {
  return (
    <SegmentToggle
      items={days.map((day) => ({
        value: String(day.day),
        label: day.label,
        helper: day.dateLabel,
      }))}
      value={String(value)}
      onChange={(next) => onChange(Number(next))}
    />
  );
}
