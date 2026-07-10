'use client';

import { useEffect, useRef, useState } from 'react';
import { LuMapPin, LuSearch, LuSparkles, LuX } from 'react-icons/lu';
import type {
  ReplanBudget,
  ReplanPace,
  ReplanPlaceDto,
  ReplanPreferencesDto,
} from '@tripick/types';

import { BottomSheet, Button, SegmentToggle, Switch } from '@/shared/ui';
import { toResolvedPlace, useKakaoPlaceSearch, type KakaoPlace } from '@/shared/lib';

import { useRequestReplan, type ReplanFormPayload } from '../model/use-request-replan';

type Props = {
  tripId: string;
  open: boolean;
  onClose: () => void;
  /** 재계획 요청 전송 성공 시 호출 (토스트 등) */
  onRequested?: () => void;
};

const PACE_OPTIONS: Array<{ value: ReplanPace; label: string }> = [
  { value: 'relaxed', label: '여유롭게' },
  { value: 'balanced', label: '균형' },
  { value: 'packed', label: '알차게' },
];

const BUDGET_OPTIONS: Array<{ value: ReplanBudget; label: string }> = [
  { value: 'thrifty', label: '알뜰' },
  { value: 'normal', label: '보통' },
  { value: 'premium', label: '프리미엄' },
];

export function ReplanModal({ tripId, open, onClose, onRequested }: Props) {
  const mutation = useRequestReplan(tripId);
  const [note, setNote] = useState('');
  const [mustPlaces, setMustPlaces] = useState<ReplanPlaceDto[]>([]);
  const [pace, setPace] = useState<ReplanPace>('balanced');
  const [avoid, setAvoid] = useState('');
  const [minimizeTravel, setMinimizeTravel] = useState(false);
  const [budget, setBudget] = useState<ReplanBudget>('normal');

  useEffect(() => {
    if (!open) return;
    setNote('');
    setMustPlaces([]);
    setPace('balanced');
    setAvoid('');
    setMinimizeTravel(false);
    setBudget('normal');
    mutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit() {
    const preferences: ReplanPreferencesDto = {
      pace,
      budget,
      ...(avoid.trim() ? { avoid: avoid.trim() } : {}),
      ...(minimizeTravel ? { minimizeTravel: true } : {}),
    };
    const payload: ReplanFormPayload = {
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(mustPlaces.length > 0 ? { mustIncludePlaces: mustPlaces } : {}),
      preferences,
    };
    mutation.mutate(payload, {
      onSuccess: () => {
        onRequested?.();
        onClose();
      },
    });
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-5 pb-6 pt-2">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-[#EAF2FF] text-[#3182F6]">
            <LuSparkles className="size-4" />
          </span>
          <div>
            <h2 className="text-[18px] font-bold text-[#191F28]">AI 재계획</h2>
            <p className="text-[12px] text-[#8B95A1]">원하는 방향을 알려주면 일정을 다시 짜드려요.</p>
          </div>
        </div>

        <div className="mt-4 space-y-5">
          <Field label="어떻게 바꿀까요?" hint="자유롭게 적어주세요">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예) 카페는 1곳만 가고 싶어요. 둘째 날은 바다 위주로 해주세요."
              maxLength={300}
              rows={3}
              className="w-full resize-none rounded-[12px] border border-[#E5E8EB] bg-white px-3 py-2 text-[14px] text-[#191F28] outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#E1ECFF]"
            />
          </Field>

          <Field label="꼭 포함할 장소" hint="이 장소들은 반드시 일정에 넣어요">
            <MustIncludePicker value={mustPlaces} onChange={setMustPlaces} />
          </Field>

          <Field label="일정 강도">
            <SegmentToggle
              items={PACE_OPTIONS}
              value={pace}
              onChange={(next) => setPace(next as ReplanPace)}
            />
          </Field>

          <Field label="예산">
            <SegmentToggle
              items={BUDGET_OPTIONS}
              value={budget}
              onChange={(next) => setBudget(next as ReplanBudget)}
            />
          </Field>

          <Field label="피하고 싶은 것">
            <input
              type="text"
              value={avoid}
              onChange={(e) => setAvoid(e.target.value)}
              placeholder="예) 대기 긴 맛집, 계단 많은 곳"
              maxLength={200}
              className="h-11 w-full rounded-[12px] border border-[#E5E8EB] bg-white px-3 text-[15px] text-[#191F28] outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#E1ECFF]"
            />
          </Field>

          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-[14px] font-semibold text-[#191F28]">이동 동선 최소화</span>
              <span className="block text-[12px] text-[#8B95A1]">가까운 장소끼리 묶어 이동을 줄여요</span>
            </span>
            <Switch
              checked={minimizeTravel}
              onChange={setMinimizeTravel}
              aria-label="이동 동선 최소화"
            />
          </label>
        </div>

        {mutation.error ? (
          <div className="mt-3 rounded-[12px] border border-[#FECDD3] bg-[#FFECEE] px-3 py-2 text-[13px] text-[#F04452]">
            {mutation.error instanceof Error ? mutation.error.message : '요청에 실패했어요.'}
          </div>
        ) : null}

        <div className="mt-5 flex gap-2">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            취소
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={mutation.isPending}
            onClick={handleSubmit}
          >
            {mutation.isPending ? '요청 중…' : 'AI에게 다시 맡기기'}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

function MustIncludePicker({
  value,
  onChange,
}: {
  value: ReplanPlaceDto[];
  onChange: (next: ReplanPlaceDto[]) => void;
}) {
  const { ready, search } = useKakaoPlaceSearch();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KakaoPlace[]>([]);
  const [openList, setOpenList] = useState(false);
  const blurTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      search(query, (places) => {
        setResults(places);
        setOpenList(places.length > 0);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, ready, search]);

  function addPlace(place: KakaoPlace) {
    const resolved = toResolvedPlace(place);
    const category = place.category_group_name || place.category_name;
    const next: ReplanPlaceDto = {
      name: resolved.name,
      address: resolved.address,
      lat: resolved.lat,
      lng: resolved.lng,
      ...(category ? { category } : {}),
    };
    const exists = value.some(
      (p) => p.name === next.name && Math.abs(p.lat - next.lat) < 1e-6,
    );
    if (!exists) onChange([...value, next]);
    setQuery('');
    setResults([]);
    setOpenList(false);
  }

  return (
    <div>
      {value.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((place, index) => (
            <span
              key={`${place.name}-${index}`}
              className="flex items-center gap-1 rounded-full border border-[#C7DCFF] bg-[#EAF2FF] py-1 pl-2.5 pr-1.5 text-[12px] font-semibold text-[#1B64DA]"
            >
              <LuMapPin className="size-3" />
              <span className="max-w-[140px] truncate">{place.name}</span>
              <button
                type="button"
                aria-label={`${place.name} 제거`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                className="flex size-4 items-center justify-center rounded-full text-[#3182F6] hover:bg-white"
              >
                <LuX className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
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
            placeholder={ready ? '장소 이름을 검색해 추가' : '지도를 불러오는 중…'}
            disabled={!ready}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-[#191F28] outline-none placeholder:text-[#B0B8C1] disabled:cursor-not-allowed"
          />
        </div>
        {openList && results.length > 0 ? (
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 max-h-56 overflow-y-auto rounded-[12px] border border-[#E5E8EB] bg-white py-1 shadow-[0_12px_28px_rgba(0,0,0,0.12)]">
            {results.map((place, index) => (
              <button
                key={`${place.place_name}-${index}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimer.current) window.clearTimeout(blurTimer.current);
                  addPlace(place);
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
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[13px] font-semibold text-[#4E5968]">{label}</span>
        {hint ? <span className="text-[11px] text-[#B0B8C1]">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
