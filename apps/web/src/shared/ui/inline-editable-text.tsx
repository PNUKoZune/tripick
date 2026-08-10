'use client';

import { useRef, useState } from 'react';

type Props = {
  /** 확정된 현재 값 (서버 기준). 변경되면 draft 가 동기화된다. */
  value: string;
  /** 값 확정 시 호출. 비었거나 동일 값이면 호출되지 않는다. */
  onCommit: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** "@" 같은 고정 접두 표식 */
  prefix?: string;
  maxLength?: number;
  disabled?: boolean;
  /** 입력 중 즉시 적용할 정규화(소문자/허용문자 필터 등) */
  sanitize?: (raw: string) => string;
  /** 표시·입력 텍스트의 폰트/색 클래스 (두 상태 공통이어야 시프트가 없음) */
  textClassName?: string;
};

/**
 * 인라인 편집 텍스트. 표시/편집 상태를 별도 엘리먼트로 교체하지 않고
 * 항상 같은 input 을 유지해 레이아웃 시프트를 없앤다.
 * - 평소: 투명 테두리 → 텍스트처럼 보임
 * - 포커스: 테두리 색 + ring(box-shadow) 만 변화 → 박스 크기 불변
 * - 너비: 숨김 sizer span 으로 내용 길이에 맞춤 → 가로 점프 없음
 */
export function InlineEditableText({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  prefix,
  maxLength,
  disabled,
  sanitize,
  textClassName = '',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const [draft, setDraft] = useState(value);

  // 외부 value 가 바뀌면 draft 를 동기화 (effect 대신 렌더 단계 조정).
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setDraft(value);
  }

  function commit() {
    if (cancelRef.current) {
      cancelRef.current = false;
      setDraft(value);
      return;
    }
    const next = draft.trim();
    if (next === '' || next === value) {
      setDraft(value);
      return;
    }
    onCommit(next);
  }

  // whitespace-pre 라 공백이 그대로 폭에 반영된다. 빈 값은 공백 한 칸으로 최소 폭 확보.
  const sizerText = draft || placeholder || ' ';

  return (
    <label
      className={`inline-flex items-center gap-1 ${disabled ? 'pointer-events-none opacity-50' : 'cursor-text'}`}
    >
      {prefix ? (
        <span className={`select-none text-[#8B95A1] ${textClassName}`}>{prefix}</span>
      ) : null}
      <span className="inline-grid">
        <span
          aria-hidden
          className={`invisible col-start-1 row-start-1 whitespace-pre border border-transparent px-1 ${textClassName}`}
        >
          {sizerText}
        </span>
        <input
          ref={inputRef}
          value={draft}
          disabled={disabled}
          maxLength={maxLength}
          // 기본 size=20 의 내재 너비가 grid 트랙을 넓혀 텍스트가 왼쪽 정렬되고 펜이 밀려난다.
          // size=1 로 두면 숨김 sizer 가 너비를 지배 → 내용에 딱 맞는 폭.
          size={1}
          aria-label={ariaLabel}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setDraft(sanitize ? sanitize(event.target.value) : event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              inputRef.current?.blur();
            }
            if (event.key === 'Escape') {
              cancelRef.current = true;
              inputRef.current?.blur();
            }
          }}
          onBlur={commit}
          className={`col-start-1 row-start-1 w-full min-w-0 rounded-[8px] border border-transparent bg-transparent px-1 outline-none focus:border-[#3182F6] focus:bg-white focus:ring-2 focus:ring-[#E1ECFF] ${textClassName}`}
        />
      </span>
      <PencilIcon />
    </label>
  );
}

function PencilIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-[#B0B8C1]"
      aria-hidden
    >
      <path d="M4 20h4l10.5-10.5a2 2 0 0 0-2.83-2.83L5.17 17.17V20Z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}
