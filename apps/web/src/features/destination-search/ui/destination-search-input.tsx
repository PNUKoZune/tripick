'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DestinationSuggestionDto } from '@tripick/types';

import { fetchDestinationSuggestions } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';

type Props = {
  value: string;
  onChange: (next: string) => void;
  onSelectSuggestion?: (suggestion: DestinationSuggestionDto) => void;
  placeholder?: string;
};

export function DestinationSearchInput({
  value,
  onChange,
  onSelectSuggestion,
  placeholder = '예) 해운대, 경주, 제주…',
}: Props) {
  const inputId = useId();
  const [debounced, setDebounced] = useState(value);
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 180);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { data: suggestions = [], isFetching } = useQuery({
    queryKey: queryKeys.planner.destinations(debounced),
    queryFn: () => fetchDestinationSuggestions(debounced),
    staleTime: 60 * 1000,
  });

  const showList = focused && suggestions.length > 0;

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="sr-only">
        여행 지역
      </label>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-12 w-full rounded-[12px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card-soft,#FFFFFF)] px-4 text-[15px] font-medium text-[color:var(--ink,#191F28)] outline-none transition placeholder:text-[color:var(--ink-faint,#B0B8C1)] focus:border-[color:var(--primary,#3182F6)] focus:bg-[color:var(--card,#FFFFFF)] focus:ring-2 focus:ring-[color:var(--ring,#E1ECFF)]"
      />
      {showList ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 max-h-72 overflow-y-auto rounded-[16px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#FFFFFF)] py-1 shadow-[0_12px_28px_rgba(0,0,0,0.08)]">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(s.name);
                onSelectSuggestion?.(s);
                setFocused(false);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[color:var(--card-soft,#F7F8FA)]"
            >
              <span className="flex-1">
                <span className="block text-[14px] font-semibold text-[color:var(--ink,#191F28)]">{s.name}</span>
                <span className="block text-[12px] text-[color:var(--ink-faint,#8B95A1)]">{s.region}</span>
              </span>
            </button>
          ))}
          {isFetching ? (
            <div className="px-4 py-2 text-[12px] text-[color:var(--ink-faint,#B0B8C1)]">검색 중…</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
