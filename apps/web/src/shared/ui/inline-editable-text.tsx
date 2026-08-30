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
 * - 폭 초과: 컨테이너보다 길면 줄어들고 말줄임 → 카드 밖으로 삐져나가지 않음
 *
 * ⚠️ `textClassName` 은 **label 에** 걸고 input 은 그걸 상속받는다. globals.css 의
 * `button, input, textarea, select { font: inherit }` 는 레이어 밖 규칙이라 Tailwind v4
 * 유틸(레이어 안)을 이기고, input 에 직접 준 `text-[13px] font-semibold` 는 무시된다.
 * 그러면 폭을 잰 sizer(13px semibold)보다 실제 글자(16px regular)가 넓어져 끝이 잘린다.
 * 부모에 얹으면 그 `inherit` 가 곧 sizer 와 같은 폰트가 된다 — 색은 UA 규칙(`input`)이
 * 상속을 덮으므로 input 에도 그대로 남긴다.
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
    // -mx-1 은 input 의 px-1 을 시각적으로 상쇄한다 — 이게 없으면 편집 가능한 줄만
    // 4px 씩 밀려 옆의 고정 텍스트(이메일 등)와 좌축이 어긋난다. 중앙 정렬에서도
    // 좌우 대칭이라 중심은 그대로다.
    <label
      className={`group -mx-1 inline-flex min-w-0 max-w-full items-center ${textClassName} ${disabled ? 'pointer-events-none opacity-50' : 'cursor-text'}`}
    >
      {/* pl-1 로 축을 되돌리고 -mr-1 로 input 의 좌 padding 을 먹어 "@" 를 값에 붙인다.
          포커스 테두리가 "@" 에 바짝 붙지만, 상시 노출되는 표시 상태를 우선한다. */}
      {prefix ? (
        <span className={`-mr-1 shrink-0 select-none pl-1 ${textClassName}`}>{prefix}</span>
      ) : null}
      {/* 폭은 sizer 가 정하되 남은 공간을 넘지 않는다. min-w-0 은 이 박스가 내용 폭 아래로
          줄어들게 하고, minmax(0,max-content) 는 그 안의 트랙까지 같이 줄인다 — 트랙은
          기본이 max-content 라, 이게 없으면 박스만 줄고 input(w-full)은 원래 폭을 유지해
          20자짜리 닉네임이 말줄임 없이 카드 밖에서 잘린다. */}
      <span className="inline-grid min-w-0 grid-cols-[minmax(0,max-content)] overflow-hidden">
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
          // text-ellipsis: 줄어든 폭에서 포커스 전 표시 상태가 "…" 로 끝나게 한다.
          className={`col-start-1 row-start-1 w-full min-w-0 text-ellipsis rounded-[8px] border border-transparent bg-transparent px-1 outline-none group-hover:bg-[color:var(--card-soft,#F8FAFD)] focus:border-[color:var(--primary,#3182F6)] focus:bg-[color:var(--card,#FFFFFF)] focus:ring-2 focus:ring-[color:var(--ring,#E1ECFF)] ${textClassName}`}
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
      className="ml-0.5 shrink-0 text-[color:var(--ink-faint,#B0B8C1)] opacity-0 transition-opacity group-hover:opacity-70 group-focus-within:opacity-70"
      aria-hidden
    >
      <path d="M4 20h4l10.5-10.5a2 2 0 0 0-2.83-2.83L5.17 17.17V20Z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}
