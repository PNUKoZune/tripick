/**
 * API 클라이언트 유틸
 * REST API → NestJS API Gateway
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';

const FALLBACK_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

async function fetcher<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, {
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

  const lower = first.toLowerCase();
  if (
    lower === 'internal server error' ||
    lower.includes('unexpected token') ||
    lower.includes('failed to fetch')
  ) {
    return FALLBACK_ERROR;
  }

  if (status >= 500) {
    return '서버 응답이 불안정합니다. 잠시 후 다시 시도해주세요.';
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

  if (typeof payload === 'object') {
    const record = payload as {
      error?: unknown;
      message?: unknown;
      details?: unknown;
    };

    if (Array.isArray(record.message)) {
      return record.message.filter((item): item is string => typeof item === 'string');
    }

    const direct = [record.message, record.error, record.details].filter(
      (item): item is string => typeof item === 'string',
    );
    if (direct.length > 0) {
      return direct;
    }
  }

  return [];
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
