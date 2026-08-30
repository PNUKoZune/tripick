'use client';

import { useEffect } from 'react';

/** 요소가 이 비율까지 올라오면 드러낸다 (뷰포트 높이 기준). */
const TRIGGER_RATIO = 0.9;

/**
 * 스크롤 등장 효과의 스위치. 화면에 들어온 `[data-reveal]` 요소에 `data-revealed` 를 붙여
 * CSS 전환(globals.css `.wvr-scope [data-reveal]`)을 시작시킨다.
 *
 * 모션 라이브러리를 쓰지 않은 이유 — 필요한 건 "보이면 속성 하나" 뿐인데, 라이브러리를
 * 넣으면 랜딩 트리 전체가 클라이언트 컴포넌트가 된다. 지금 랜딩은 CTA 를 뺀 전부가 서버
 * 렌더라 첫 페인트에 JS 를 기다리지 않는다. 그 성질을 지키려고 감시자만 섬으로 띄운다.
 *
 * 숨김 상태를 CSS 가 아니라 이 컴포넌트가 켜는 이유 — JS 가 죽거나 늦으면 `opacity:0` 이
 * 그대로 남아 페이지가 백지로 보인다. 마운트된 뒤에 루트에 `data-reveal-ready` 를 붙이고,
 * CSS 는 그 안에서만 숨기므로 JS 가 없으면 처음부터 다 보인다.
 *
 * IntersectionObserver 가 아니라 위치를 직접 재는 이유 — 앵커 링크로 페이지 중간을 건너뛰면
 * 지나친 요소들은 "교차한 적 없이" 화면 위로 올라가 콜백이 아예 안 돈다. 그 자리에 스크롤로
 * 되돌아와도 opacity 0 인 채 남는다. 위쪽으로 지나간 것(top < 0)까지 한 판정으로 덮는다.
 */
export function ScrollReveal({ rootSelector = '.wvr-scope' }: { rootSelector?: string }) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(rootSelector);
    if (!root) return;

    const pending = new Set(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (pending.size === 0) return;

    const reveal = (el: HTMLElement) => {
      el.setAttribute('data-revealed', '');
      pending.delete(el);
    };

    // 모션을 끈 사용자에겐 전환 없이 즉시 확정한다 — 숨김 자체를 켜지 않는다.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      pending.forEach(reveal);
      return;
    }

    root.setAttribute('data-reveal-ready', '');

    let frame = 0;
    const check = () => {
      frame = 0;
      const line = window.innerHeight * TRIGGER_RATIO;
      for (const el of Array.from(pending)) {
        if (el.getBoundingClientRect().top < line) reveal(el);
      }
      if (pending.size === 0) stop();
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(check);
    };
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // 첫 화면에 이미 들어와 있는 것은 전환을 기다리지 않고 이번 프레임에 확정한다.
    check();

    return stop;
  }, [rootSelector]);

  return null;
}
