'use client';

/**
 * 화면 전환을 건너 살아남는 1회성 안내 메시지("플래시").
 *
 * 가드가 리다이렉트하면서 토스트를 띄우면, 그 토스트는 곧바로 언마운트된다 —
 * 메시지를 컴포넌트가 아니라 sessionStorage 에 두고 도착한 화면에서 꺼내 보여준다.
 * localStorage 가 아닌 이유: 탭을 닫으면 사라져야 하고, 다음 세션까지 남으면 안 된다.
 * 모듈 변수가 아닌 이유: 가드의 하드 네비게이션 폴백(`window.location.replace`)이
 * 문서를 다시 띄우므로 메모리 상태는 그 순간 날아간다.
 */

const FLASH_KEY = 'tripick.session-flash';

export type SessionFlashTone = 'neutral' | 'primary' | 'warning' | 'error';

export type SessionFlash = {
  title: string;
  message?: string;
  tone?: SessionFlashTone;
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 다음 화면에서 한 번 보여줄 메시지를 적어 둔다. */
export function setSessionFlash(flash: SessionFlash): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(FLASH_KEY, JSON.stringify(flash));
  } catch {
    // 사파리 프라이빗 모드 등 storage 차단 환경 — 안내를 못 띄울 뿐 리다이렉트는 계속된다.
    return;
  }
  emit();
}

export function clearSessionFlash(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(FLASH_KEY);
  } catch {
    return;
  }
  emit();
}

/**
 * useSyncExternalStore 용 스냅샷. 파싱 결과가 아니라 **원본 문자열**을 돌려준다 —
 * 매번 새 객체를 만들면 참조가 달라져 무한 렌더에 빠진다.
 */
export function getSessionFlashSnapshot(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(FLASH_KEY);
  } catch {
    return null;
  }
}

export function getSessionFlashServerSnapshot(): string | null {
  return null;
}

export function subscribeSessionFlash(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function parseSessionFlash(raw: string | null): SessionFlash | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionFlash;
    return typeof parsed?.title === 'string' ? parsed : null;
  } catch {
    return null;
  }
}
