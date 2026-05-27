const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';
const SESSION_KEY = 'tripick.session.v1';

const FALLBACK_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

export function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

async function fetcher<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Authorization')) {
    const token = getStoredAccessToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const res = await fetch(apiUrl(path), {
    ...init,
    headers,
  });
  const payload = await parseResponse(res);

  if (!res.ok) {
    throw Object.assign(new Error(normalizeErrorMessage(payload, res.status)), {
      payload,
      status: res.status,
    });
  }

  return payload as T;
}

function getStoredAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const session = JSON.parse(raw) as { tokens?: { accessToken?: unknown } };
    return typeof session.tokens?.accessToken === 'string' ? session.tokens.accessToken : null;
  } catch {
    return null;
  }
}

async function parseResponse(res: Response): Promise<unknown> {
  if (res.status === 204) {
    return null;
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return res.json().catch(() => null);
  }
  const text = await res.text().catch(() => '');
  return text || null;
}

function normalizeErrorMessage(payload: unknown, status: number): string {
  const candidates = extractMessages(payload)
    .map((message) => message.trim())
    .filter(Boolean);
  const first = candidates[0];

  if (!first) {
    return status >= 500 ? FALLBACK_ERROR : `요청에 실패했습니다. (${status})`;
  }
  if (status >= 500) {
    return FALLBACK_ERROR;
  }
  return first;
}

function extractMessages(payload: unknown): string[] {
  if (!payload) {
    return [];
  }
  if (typeof payload === 'string') {
    return [payload];
  }
  if (typeof payload !== 'object') {
    return [];
  }

  const record = payload as { error?: unknown; message?: unknown; details?: unknown };
  if (Array.isArray(record.message)) {
    return record.message.filter((item): item is string => typeof item === 'string');
  }
  return [record.message, record.error, record.details].filter(
    (item): item is string => typeof item === 'string',
  );
}

export const api = {
  get: <T>(path: string, token?: string) =>
    fetcher<T>(path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),

  post: <T>(path: string, body: unknown, token?: string) =>
    fetcher<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),

  put: <T>(path: string, body: unknown, token?: string) =>
    fetcher<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),

  patch: <T>(path: string, body: unknown, token?: string) =>
    fetcher<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),

  delete: <T>(path: string, token?: string) =>
    fetcher<T>(path, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
};
