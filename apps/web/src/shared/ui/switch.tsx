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
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
        checked ? 'bg-[#3182F6]' : 'bg-[#E5E8EB]'
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
