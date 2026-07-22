'use client';

import { useEffect, useRef, useState } from 'react';
import { LuMapPin, LuSearch } from 'react-icons/lu';
import type { PlannerItemType, PlannerItineraryItemDto } from '@tripick/types';

import { BottomSheet, Button, SegmentToggle } from '@/shared/ui';
import {
  toResolvedPlace,
  useKakaoPlaceSearch,
  type KakaoPlace,
  type KakaoResolvedPlace,
} from '@/shared/lib';

export type ItemEditorValues = {
  name: string;
  type: PlannerItemType;
  scheduledAt: string;
  durationMin: number;
  memo: string;
  address?: string;
  lat?: number;
  lng?: number;
  kakaoPlaceId?: string;
};

type Props = {
  open: boolean;
  mode: 'add' | 'edit';
  /** edit 모드일 때 prefill 대상 */
  item?: PlannerItineraryItemDto | null;
  pending: boolean;
  error?: string | null;
  /** 제출 버튼 라벨 override (비-owner 제안 모드: "변경 요청") */
  submitLabel?: string;
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
  submitLabel,
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

  // 추가 모드에서는 실제 존재하는 장소(좌표 포함)를 골라야 제출할 수 있다
  const placePicked = mode === 'edit' || (values.name.trim().length > 0 && values.lat !== undefined);
  const canSubmit = placePicked && /^\d{2}:\d{2}$/.test(values.scheduledAt);

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-5 pb-6 pt-2">
        <h2 className="text-[18px] font-bold text-[#191F28]">
          {mode === 'add' ? '일정 추가' : '일정 수정'}
        </h2>
        <p className="mt-1 text-[13px] text-[#8B95A1]">
          {mode === 'add'
            ? '실제 장소를 검색해 추가해요. 장소를 고르면 지도 위치도 함께 저장됩니다.'
            : '시간·체류시간·메모를 수정할 수 있어요. 장소를 바꾸려면 카드의 변경(대안) 버튼을 이용하세요.'}
        </p>

        <div className="mt-4 space-y-4">
          {mode === 'add' ? (
            <Field label="장소 검색">
              <PlaceSearchField
                picked={
                  values.lat !== undefined && values.name
                    ? { name: values.name, address: values.address ?? '' }
                    : null
                }
                onPick={(place) =>
                  setValues((v) => {
                    const { kakaoPlaceId: _prev, ...rest } = v;
                    void _prev;
                    return {
                      ...rest,
                      name: place.name,
                      address: place.address,
                      lat: place.lat,
                      lng: place.lng,
                      ...(place.kakaoPlaceId ? { kakaoPlaceId: place.kakaoPlaceId } : {}),
                    };
                  })
                }
                onClear={() =>
                  setValues((v) => {
                    const { address, lat, lng, kakaoPlaceId, ...rest } = v;
                    void address;
                    void lat;
                    void lng;
                    void kakaoPlaceId;
                    return { ...rest, name: '' };
                  })
                }
              />
            </Field>
          ) : (
            <Field label="장소">
              <div className="flex items-center gap-2 rounded-[12px] border border-[#E5E8EB] bg-[#F7F8FA] px-3 py-2.5">
                <LuMapPin className="size-4 shrink-0 text-[#8B95A1]" />
                <span className="truncate text-[15px] font-semibold text-[#191F28]">
                  {values.name}
                </span>
              </div>
            </Field>
          )}

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
              placeholder="예약 시간, 준비물 등 나만의 메모를 남겨보세요."
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
              onSubmit({ ...values, name: values.name.trim(), memo: values.memo.trim() })
            }
          >
            {pending ? '저장 중…' : (submitLabel ?? (mode === 'add' ? '추가' : '저장'))}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

function PlaceSearchField({
  picked,
  onPick,
  onClear,
}: {
  picked: { name: string; address: string } | null;
  onPick: (place: KakaoResolvedPlace) => void;
  onClear: () => void;
}) {
  const { ready, search } = useKakaoPlaceSearch();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KakaoPlace[]>([]);
  const [openList, setOpenList] = useState(false);
  const blurTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!ready || picked) return;
    const timer = setTimeout(() => {
      search(query, (places) => {
        setResults(places);
        setOpenList(places.length > 0);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, ready, picked, search]);

  if (picked) {
    return (
      <div className="flex items-center gap-2 rounded-[12px] border border-[#C7DCFF] bg-[#EAF2FF] px-3 py-2.5">
        <LuMapPin className="size-4 shrink-0 text-[#3182F6]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-[#191F28]">
            {picked.name}
          </span>
          {picked.address ? (
            <span className="block truncate text-[12px] text-[#6B7684]">{picked.address}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-[8px] px-2 py-1 text-[12px] font-semibold text-[#3182F6] hover:bg-white"
        >
          다시 검색
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex h-11 items-center rounded-[12px] border border-[#E5E8EB] bg-white px-3 focus-within:border-[#3182F6] focus-within:ring-2 focus-within:ring-[#E1ECFF]">
        <LuSearch className="mr-2 size-4 shrink-0 text-[#8B95A1]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setOpenList(true);
          }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setOpenList(false), 120);
          }}
          placeholder={ready ? '장소 이름을 검색하세요 (예: 첨성대)' : '지도를 불러오는 중…'}
          disabled={!ready}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-[#191F28] outline-none placeholder:text-[#B0B8C1] disabled:cursor-not-allowed"
        />
      </div>
      {openList && results.length > 0 ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 max-h-64 overflow-y-auto rounded-[12px] border border-[#E5E8EB] bg-white py-1 shadow-[0_12px_28px_rgba(0,0,0,0.12)]">
          {results.map((place, index) => (
            <button
              key={`${place.place_name}-${index}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                if (blurTimer.current) window.clearTimeout(blurTimer.current);
                onPick(toResolvedPlace(place));
                setOpenList(false);
              }}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[#F7F8FA]"
            >
              <span className="text-[14px] font-semibold text-[#191F28]">{place.place_name}</span>
              <span className="text-[12px] text-[#8B95A1]">
                {place.road_address_name || place.address_name}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
