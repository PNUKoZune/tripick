'use client';

import { useEffect, useState } from 'react';
import type { PlannerItemType, PlannerItineraryItemDto } from '@tripick/types';

import { BottomSheet, Button, SegmentToggle } from '@/shared/ui';

export type ItemEditorValues = {
  name: string;
  type: PlannerItemType;
  scheduledAt: string;
  durationMin: number;
  memo: string;
};

type Props = {
  open: boolean;
  mode: 'add' | 'edit';
  /** edit 모드일 때 prefill 대상 */
  item?: PlannerItineraryItemDto | null;
  pending: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (values: ItemEditorValues) => void;
};

const TYPE_OPTIONS: Array<{ value: PlannerItemType; label: string }> = [
  { value: 'attraction', label: '관광' },
  { value: 'restaurant', label: '식사' },
  { value: 'cafe', label: '카페' },
  { value: 'transport', label: '이동' },
];

const DEFAULTS: ItemEditorValues = {
  name: '',
  type: 'attraction',
  scheduledAt: '10:00',
  durationMin: 60,
  memo: '',
};

export function ItemEditorSheet({
  open,
  mode,
  item,
  pending,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<ItemEditorValues>(DEFAULTS);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && item) {
      setValues({
        name: item.name,
        type: item.type,
        scheduledAt: item.scheduledAt,
        durationMin: item.durationMin,
        memo: item.memo ?? '',
      });
    } else {
      setValues(DEFAULTS);
    }
  }, [open, mode, item]);

  const canSubmit = values.name.trim().length > 0 && /^\d{2}:\d{2}$/.test(values.scheduledAt);

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-5 pb-6 pt-2">
        <h2 className="text-[18px] font-bold text-[#191F28]">
          {mode === 'add' ? '일정 추가' : '일정 수정'}
        </h2>
        <p className="mt-1 text-[13px] text-[#8B95A1]">
          {mode === 'add'
            ? '이 날짜에 새 일정을 추가해요. 추가 후 지도에서 위치도 바꿀 수 있어요.'
            : '시간·메모·장소명을 수정할 수 있어요.'}
        </p>

        <div className="mt-4 space-y-4">
          <Field label="장소명">
            <input
              type="text"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              placeholder="예) 첨성대"
              maxLength={120}
              className="h-11 w-full rounded-[12px] border border-[#E5E8EB] bg-white px-3 text-[15px] text-[#191F28] outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#E1ECFF]"
            />
          </Field>

          {mode === 'add' ? (
            <Field label="종류">
              <SegmentToggle
                items={TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={values.type}
                onChange={(next) => setValues((v) => ({ ...v, type: next as PlannerItemType }))}
              />
            </Field>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="시작 시간">
              <input
                type="time"
                value={values.scheduledAt}
                onChange={(e) => setValues((v) => ({ ...v, scheduledAt: e.target.value }))}
                className="h-11 w-full rounded-[12px] border border-[#E5E8EB] bg-white px-3 text-[15px] text-[#191F28] outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#E1ECFF]"
              />
            </Field>
            <Field label="체류 시간(분)">
              <input
                type="number"
                min={0}
                max={1440}
                step={5}
                value={values.durationMin}
                onChange={(e) =>
                  setValues((v) => ({ ...v, durationMin: Number(e.target.value) || 0 }))
                }
                className="h-11 w-full rounded-[12px] border border-[#E5E8EB] bg-white px-3 text-[15px] text-[#191F28] outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#E1ECFF]"
              />
            </Field>
          </div>

          <Field label="메모">
            <textarea
              value={values.memo}
              onChange={(e) => setValues((v) => ({ ...v, memo: e.target.value }))}
              placeholder="예약 시간, 준비물 등을 적어두세요."
              maxLength={500}
              rows={3}
              className="w-full resize-none rounded-[12px] border border-[#E5E8EB] bg-white px-3 py-2 text-[14px] text-[#191F28] outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#E1ECFF]"
            />
          </Field>
        </div>

        {error ? (
          <div className="mt-3 rounded-[12px] border border-[#FECDD3] bg-[#FFECEE] px-3 py-2 text-[13px] text-[#F04452]">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex gap-2">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            onClick={onClose}
            disabled={pending}
          >
            취소
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={!canSubmit || pending}
            onClick={() =>
              onSubmit({
                ...values,
                name: values.name.trim(),
                memo: values.memo.trim(),
              })
            }
          >
            {pending ? '저장 중…' : mode === 'add' ? '추가' : '저장'}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-[#4E5968]">{label}</span>
      {children}
    </label>
  );
}
