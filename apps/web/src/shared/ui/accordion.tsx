'use client';

import type { ReactNode } from 'react';
import { LuChevronDown } from 'react-icons/lu';

/**
 * 여닫히는 패널 한 칸. 취향 화면의 테마 대분류와 랜딩 FAQ 가 같은 동작을 쓰도록 뽑아냈다.
 *
 * 높이는 `grid-template-rows` 0fr↔1fr 로 전환한다 — `max-height` 로 하면 칸마다 내용 길이가
 * 달라 짧은 칸은 다 열린 뒤에도 계속 기다리고, 긴 칸은 중간에 잘린다. 0fr↔1fr 은 실제 내용
 * 높이를 브라우저가 재므로 값을 못 박을 필요가 없다.
 *
 * `<details>` 를 쓰지 않은 이유 — 네이티브 요소는 열림/닫힘이 즉시라 높이 전환을 붙일 자리가
 * 없다. `::details-content` 로 되는 브라우저가 있지만 아직 갈려서, 두 화면이 같은 동작을
 * 보장하려면 상태를 직접 들고 있어야 한다.
 *
 * 접어도 언마운트하지 않는다 — `aria-controls` 가 가리키는 패널이 사라지면 안 되고, DOM 을
 * 지웠다 되살리면 펼칠 때마다 내용이 다시 만들어진다. 대신 `inert` 로 접힌 패널이 탭 순서·
 * 스크린리더에 잡히지 않게 한다.
 */
export function Accordion({
  panelId,
  open,
  onToggle,
  summary,
  children,
  className = '',
  headerClassName = '',
  panelClassName = '',
}: {
  /** 패널 엘리먼트 id. 한 화면 안에서 유일해야 `aria-controls` 가 맞는 곳을 가리킨다. */
  panelId: string;
  open: boolean;
  onToggle: () => void;
  /** 머리줄 안쪽 — 제목, 배지 등. 화살표는 컴포넌트가 붙인다. */
  summary: ReactNode;
  children: ReactNode;
  /** 바깥 테두리·모서리 등 칸 전체의 겉모습. */
  className?: string;
  /** 머리줄의 여백·글자 크기. */
  headerClassName?: string;
  /** 펼쳐진 내용의 여백. */
  panelClassName?: string;
}) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex w-full items-center gap-2 text-left transition hover:bg-[color:var(--card-soft)] ${headerClassName}`}
      >
        <span className="flex flex-1 items-center gap-1">{summary}</span>
        <LuChevronDown
          aria-hidden
          className={`size-4 shrink-0 text-[color:var(--ink-faint)] transition-transform duration-200 ease-out motion-reduce:transition-none ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      <div
        id={panelId}
        inert={!open}
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className={panelClassName}>{children}</div>
        </div>
      </div>
    </div>
  );
}
