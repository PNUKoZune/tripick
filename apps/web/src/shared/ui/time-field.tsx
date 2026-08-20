'use client';

import { useId, useRef } from 'react';
import { LuClock3 } from 'react-icons/lu';

type Variant = 'outlined' | 'soft';

type Props = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  /** 'outlined'(기본, 여행 생성 폼) / 'soft'(취향 설정 - soft-bg 박스, 굵은 큰 글씨) */
  variant?: Variant;
};

/**
 * 시각 선택(HH:mm). 네이티브 `<input type="time">` 이라 모바일·웹뷰에서는 OS 시간 피커가
 * 그대로 뜨고, 값은 로케일과 무관하게 항상 24시간 "HH:mm" 문자열이다.
 *
 * 이전에는 MUI X TimePicker(아날로그 시계 팝업)를 썼는데, 그 하나 때문에
 * `@mui/material` + `@mui/x-date-pickers` + emotion 이 `shared/ui` 배럴을 타고
 * **모든 라우트**의 첫 로드에 들어갔다(약 440KB). 팝업이 body 로 portal 돼
 * `.wvr-scope` 토큰이 안 닿는 문제(팔레트 mode 로만 다크 대응)도 같이 사라진다.
 */
export function TimeField({ label, value, onChange, variant = 'outlined' }: Props) {
  const isSoft = variant === 'soft';
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // 크롬 데스크탑은 인풋 본문 클릭만으로는 피커가 안 열린다(달력 인디케이터만 열림).
  // showPicker 는 사용자 제스처 밖이거나 미지원이면 던지므로 조용히 무시한다.
  function openPicker() {
    try {
      inputRef.current?.showPicker();
    } catch {
      inputRef.current?.focus();
    }
  }

  return (
    <div
      className={
        isSoft
          ? 'flex flex-col gap-1 rounded-[16px] bg-[color:var(--soft-bg)] px-4 py-3'
          : 'flex flex-col gap-1'
      }
    >
      <label
        htmlFor={inputId}
        className={
          isSoft
            ? 'text-[13px] font-bold text-[color:var(--text-tertiary)]'
            : 'text-[12px] font-semibold text-[color:var(--ink-sub,#6B7684)]'
        }
      >
        {label}
      </label>
      <div
        className={
          isSoft
            ? 'flex items-center gap-1'
            : 'flex h-12 items-center gap-1 rounded-[12px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#fff)] pl-4 pr-2 transition focus-within:border-[color:var(--primary,#3182F6)] focus-within:ring-2 focus-within:ring-[color:var(--ring,#E1ECFF)]'
        }
      >
        <input
          id={inputId}
          ref={inputRef}
          type="time"
          step={60}
          value={value}
          onChange={(event) => {
            // 사용자가 값을 지우는 중이면 빈 문자열이 온다 — 상위 상태는 항상 유효한
            // HH:mm 만 갖도록 무시한다(입력 도중 일정 계산이 깨지지 않게).
            if (event.target.value) onChange(event.target.value);
          }}
          className={`time-input min-w-0 flex-1 bg-transparent outline-none ${
            isSoft
              ? 'text-[20px] font-extrabold leading-7 text-[color:var(--text-primary)]'
              : 'text-[15px] font-medium text-[color:var(--ink,#191F28)]'
          }`}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={openPicker}
          className={`flex shrink-0 items-center justify-center rounded-[8px] text-[color:var(--ink-faint,#8B95A1)] transition hover:text-[color:var(--ink-sub,#6B7684)] ${
            isSoft ? 'size-6' : 'size-8'
          }`}
        >
          <LuClock3 className={isSoft ? 'size-4' : 'size-5'} />
        </button>
      </div>
    </div>
  );
}
