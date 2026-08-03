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
      // 색은 전역 토큰으로 — 라이트 값은 그대로고, .wvr-scope 안에서 렌더될 때만 그
      // 스코프의 다크 값을 상속받아 화면 안 파랑이 어긋나지 않는다.
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
        checked ? 'bg-[color:var(--blue-600)]' : 'bg-[color:var(--line-strong)]'
      }`}
      {...aria}
    >
      <span
        aria-hidden
        className={`inline-block size-5 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
