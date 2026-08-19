import type { AriaAttributes } from 'react';

type Props = {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
} & AriaAttributes;

export function Switch({ checked, disabled, onChange, ...aria }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      // 색은 wvr 토큰 우선, 스코프 밖에서는 전역 토큰으로 폴백한다 — 스위치는
      // .wvr-scope 안팎 양쪽에서 쓰이는데 --primary/--line-dot 은 스코프에만 있어
      // 폴백이 없으면 선언이 통째로 무효가 되며 색이 사라진다.
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
        checked
          ? 'bg-[color:var(--primary,var(--blue-600))]'
          : 'bg-[color:var(--line-dot,var(--line-strong))]'
      }`}
      {...aria}
    >
      <span
        aria-hidden
        className={`inline-block size-5 transform rounded-full bg-[color:var(--card,#fff)] shadow transition ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
