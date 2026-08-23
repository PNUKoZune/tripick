import {
  clearStoredSession,
  getAccessToken,
  getRefreshToken,
  replaceTokens,
} from '@/shared/lib/session-token';
import { isNativeShell, requestNativeRefreshToken } from '@/shared/rn-bridge/native-refresh-token';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';

const FALLBACK_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
const RATE_LIMIT_ERROR = '요청이 너무 잦아요. 잠시 후 다시 시도해주세요.';

/**
 * fetcher 가 던지는 에러. `status` 로 분기하고, 429 면 `retryAfterSeconds` 로 재시도 UI 를 만든다.
 * (남은 초를 메시지에 굽지 않는 건 카운트다운이 도는 동안 문구가 낡기 때문 — 초는 UI 가 직접 센다)
 */
export type ApiError = Error & {
  status?: number;
  payload?: unknown;
  /** 429 응답 `Retry-After` 헤더의 초. 헤더가 없거나 429 가 아니면 undefined. */
  // exactOptionalPropertyTypes 라 "키는 있고 값이 undefined" 케이스를 명시해야 한다.
  retryAfterSeconds?: number | undefined;
};

// 401 시 백엔드에 refresh 시도 — 다발성 호출을 1회로 합치기 위해 공유 Promise.
// 같은 시점에 여러 API 호출이 401 받으면 모두 같은 refresh 결과를 기다린다.
let refreshInFlight: Promise<string | null> | null = null;

export function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

/**
 * 절대 API base URL. `API_BASE` 가 상대값(`/api/v1`)이면 현재 origin 에 붙여 절대화한다.
 * RN 네이티브가 웹뷰 밖(백그라운드)에서 직접 호출할 때 쓰라고 노출한다 — 상대 경로는
 * 네이티브에서 해석할 수 없으므로 웹이 자기 origin 기준으로 풀어 넘겨야 한다.
 */
export function apiBaseUrl(): string {
  if (/^https?:\/\//.test(API_BASE)) return API_BASE;
  if (typeof window === 'undefined') return API_BASE;
  return `${window.location.origin}${API_BASE}`;
}

async function fetcher<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  const headers = new Headers(init?.headers);
  const isFormDataBody =
    typeof FormData !== 'undefined' && init?.body instanceof FormData;
  if (!headers.has('Content-Type') && init?.body && !isFormDataBody) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Authorization')) {
    const token = getAccessToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const res = await fetch(apiUrl(path), {
    ...init,
    headers,
  });

  // 401 + 최초 시도 + auth/refresh·login 자체가 아닌 경우 → 자동 refresh 후 1회 재시도
  if (res.status === 401 && attempt === 0 && !path.startsWith('/auth/')) {
    const newAccessToken = await tryRefresh();
    if (newAccessToken) {
      return fetcher<T>(path, init, attempt + 1);
    }
  }

  const payload = await parseResponse(res);

  if (!res.ok) {
    // 인증된 요청이 401 → 세션 만료. /auth/* (로그인 시도 등) 의 401 은 자격 증명 실패라 세션을 건드리지 않는다.
    const isAuthEndpoint = path.startsWith('/auth/');
    if (res.status === 401 && !isAuthEndpoint) {
      clearStoredSession('expired');
    }
    const retryAfterSeconds =
      res.status === 429 ? parseRetryAfter(res.headers.get('Retry-After')) : undefined;
    const error: ApiError = Object.assign(
      new Error(normalizeErrorMessage(payload, res.status, isAuthEndpoint)),
      { payload, status: res.status, retryAfterSeconds },
    );
    throw error;
  }

  return payload as T;
}

async function tryRefresh(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    // RN 웹뷰에선 refresh 가 네이티브 SecureStore 에 있어 브리지로 가져온다.
    const refreshToken = isNativeShell() ? await requestNativeRefreshToken() : getRefreshToken();
    if (!refreshToken) return null;
    try {
      const res = await fetch(apiUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        clearStoredSession('expired');
        return null;
      }
      const tokens = (await res.json()) as { accessToken: string; refreshToken: string };
      replaceTokens(tokens);
      return tokens.accessToken;
    } catch {
      clearStoredSession('expired');
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
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

/**
 * `Retry-After` 파싱. 스펙상 delta-seconds 또는 HTTP-date 두 형식이라 둘 다 받는다.
 * (NestJS throttler 는 초를 주지만 프록시가 날짜로 바꿔 줄 수 있음)
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const at = Date.parse(header);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** 429 에러면 남은 대기 초(헤더 없으면 0), 아니면 0. 재시도 UI 가 쓰는 진입점. */
export function rateLimitRetrySeconds(error: unknown): number {
  if (!(error instanceof Error)) return 0;
  const { status, retryAfterSeconds } = error as ApiError;
  if (status !== 429) return 0;
  return retryAfterSeconds ?? 0;
}

function normalizeErrorMessage(payload: unknown, status: number, isAuthEndpoint = false): string {
  // 세션 만료 안내는 인증된 요청에만. 로그인/가입 같은 /auth/* 401 은 서버 메시지를 그대로 노출.
  if (status === 401 && !isAuthEndpoint) {
    return '로그인이 만료됐어요. 다시 로그인해주세요.';
  }
  // throttler 기본 본문이 영문("ThrottlerException: Too many requests") 이라 서버 메시지를 안 쓴다.
  if (status === 429) {
    return RATE_LIMIT_ERROR;
  }

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

  upload: <T>(path: string, formData: FormData, token?: string) =>
    fetcher<T>(path, {
      method: 'POST',
      body: formData,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
};
