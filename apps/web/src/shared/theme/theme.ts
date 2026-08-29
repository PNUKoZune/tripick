/** 사용자가 고르는 값. `system` 은 OS 설정을 그대로 따른다. */
export type ThemePreference = 'system' | 'light' | 'dark';
/** 실제로 화면에 적용되는 값. `system` 을 해석한 결과다. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'tripick.theme.v1';

/** 브라우저·웹뷰 크롬 색. globals.css 의 --bg (광안리의 하루 팔레트)와 같은 값. */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#F5F7FB',
  dark: '#0B111E',
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** 저장값이 없거나 깨졌으면 시스템 추종. JSON 이 아니라 원문 문자열로 둔다 —
 *  부팅 스크립트(THEME_INIT_SCRIPT)가 같은 값을 파싱 없이 읽어야 해서다. */
export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

/** 저장 자체가 스토어의 변경 신호다 — 구독자(useSyncExternalStore)를 함께 깨운다. */
export function writeThemePreference(preference: ThemePreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // 프라이빗 모드 등 저장 불가 — 이번 세션에만 적용되고 다음 방문엔 시스템 추종.
  }
  listeners.forEach((listener) => listener());
}

const listeners = new Set<() => void>();

/** 이 탭의 변경(writeThemePreference)과 다른 탭의 변경(storage 이벤트)을 함께 알린다. */
export function subscribeThemePreference(onChange: () => void): () => void {
  listeners.add(onChange);
  if (typeof window !== 'undefined') window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onChange);
  };
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference;
}

export function subscribeSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * 해석이 끝난 테마를 문서에 반영한다. CSS 가 보는 훅은 `data-theme` 하나뿐이고
 * (globals.css 의 `:root[data-theme='dark'] .wvr-scope`), 상태바·브라우저 크롬 색은
 * meta 태그를 직접 갱신한다 — Next 의 viewport.themeColor 는 정적이라 사용자가
 * OS 와 다른 테마를 고르면 상단 바만 반대 색으로 남는다.
 */
export function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', THEME_COLOR[theme]);
}

/**
 * 첫 페인트 전에 테마를 확정하는 head 인라인 스크립트. React 가 붙기를 기다리면
 * 다크 사용자에게 흰 화면이 한 번 번쩍인다. 위 함수들과 같은 규칙을 최소한으로 옮긴 것이라
 * 저장 키·색·판정 순서를 바꿀 때 함께 고쳐야 한다.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
var dark=p==='dark'||(p!=='light'&&matchMedia('${DARK_QUERY}').matches);
document.documentElement.dataset.theme=dark?'dark':'light';
var m=document.querySelector('meta[name="theme-color"]');
if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.appendChild(m)}
m.setAttribute('content',dark?'${THEME_COLOR.dark}':'${THEME_COLOR.light}')
}catch(e){}})()`;
