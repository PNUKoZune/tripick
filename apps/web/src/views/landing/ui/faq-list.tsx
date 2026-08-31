'use client';

import { useState } from 'react';

import { Accordion } from '@/shared/ui';

/**
 * FAQ 목록. 여닫는 높이 전환을 붙이려면 열림 상태를 들고 있어야 해서 이 조각만 클라이언트다
 * (랜딩의 나머지 본문은 서버 렌더 그대로). 동작·속도는 취향 화면의 테마 아코디언과 같은
 * `Accordion` 을 쓴다.
 *
 * 여러 개를 동시에 열 수 있게 둔다 — 취향 화면도 그렇고, 답을 견주어 읽는 화면에서 하나를
 * 열 때마다 앞서 읽던 게 닫히면 되레 방해가 된다.
 */
export function FaqList({ items }: { items: ReadonlyArray<{ q: string; a: string }> }) {
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});

  return (
    <ul className="flex flex-col gap-3">
      {items.map((faq, index) => (
        <li key={faq.q} data-reveal style={{ ['--reveal-delay' as string]: `${index * 60}ms` }}>
          <Accordion
            panelId={`faq-${index}`}
            open={Boolean(openKeys[faq.q])}
            onToggle={() => setOpenKeys((prev) => ({ ...prev, [faq.q]: !prev[faq.q] }))}
            className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card)]"
            headerClassName="px-5 py-4"
            panelClassName="px-5 pb-4"
            summary={
              <span className="text-[15.5px] font-bold tracking-[-0.015em] text-[color:var(--ink)]">
                {faq.q}
              </span>
            }
          >
            <p className="text-[14.5px] leading-[1.68] text-[color:var(--ink-sub)]">{faq.a}</p>
          </Accordion>
        </li>
      ))}
    </ul>
  );
}
