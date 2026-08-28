/**
 * 브라우저 저장소 접근. 기본은 localStorage 이고, 이 탭에서 진행 중인 절차처럼 탭을 닫으면
 * 같이 사라져야 하는 값은 `'session'` 으로 sessionStorage 를 고른다.
 */
type StorageScope = 'local' | 'session';

function store(scope: StorageScope): Storage | null {
  if (typeof window === 'undefined') return null;
  return scope === 'session' ? window.sessionStorage : window.localStorage;
}

export function readJson<T>(key: string, scope: StorageScope = 'local'): T | null {
  const storage = store(scope);
  if (!storage) {
    return null;
  }
  const value = storage.getItem(key);
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeJson<T>(key: string, value: T, scope: StorageScope = 'local'): void {
  const storage = store(scope);
  if (!storage) {
    return;
  }
  storage.setItem(key, JSON.stringify(value));
}

export function removeStored(key: string, scope: StorageScope = 'local'): void {
  const storage = store(scope);
  if (!storage) {
    return;
  }
  storage.removeItem(key);
}
