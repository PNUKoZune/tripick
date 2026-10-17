import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ access: 'old', refresh: 'refresh', native: false }));
const clear = vi.hoisted(() => vi.fn());
const bridge = vi.hoisted(() => vi.fn());
vi.mock('@/shared/lib/session-token', () => ({
  getAccessToken: () => session.access || null,
  getRefreshToken: () => session.refresh || null,
  clearStoredSession: clear,
  replaceTokens: (tokens: { accessToken: string; refreshToken: string }) => {
    session.access = tokens.accessToken;
    session.refresh = tokens.refreshToken;
  },
}));
vi.mock('@/shared/rn-bridge/native-refresh-token', () => ({
  isNativeShell: () => session.native,
  requestNativeRefreshToken: bridge,
}));

const response = (status: number, data = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('API session recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    session.access = 'old';
    session.refresh = 'refresh';
    session.native = false;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('can refresh after a previous request had no refresh token', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { accessToken: 'new', refreshToken: 'new-refresh' }))
      .mockResolvedValueOnce(response(200, { ok: true }));
    vi.stubGlobal('fetch', fetch);
    const { api } = await import('@/shared/api/client');
    session.refresh = '';
    await expect(api.get('/users/me')).rejects.toMatchObject({ status: 401 });
    session.refresh = 'refresh-after-login';
    await expect(api.get('/users/me')).resolves.toEqual({ ok: true });
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(
      1,
    );
  });

  it.each(['server', 'network', 'bridge'])(
    'preserves credentials and releases the lock after %s failure',
    async (failure) => {
      const fetch = vi.fn().mockResolvedValueOnce(response(401));
      if (failure === 'server') fetch.mockResolvedValueOnce(response(503));
      if (failure === 'network') fetch.mockRejectedValueOnce(new Error('offline'));
      if (failure === 'bridge') {
        session.native = true;
        bridge.mockRejectedValueOnce(new Error('timeout'));
      }
      vi.stubGlobal('fetch', fetch);
      const { api } = await import('@/shared/api/client');
      await expect(api.get('/users/me')).rejects.toMatchObject({ status: 503 });
      expect(clear).not.toHaveBeenCalled();
      session.native = false;
      fetch
        .mockResolvedValueOnce(response(401))
        .mockResolvedValueOnce(response(200, { accessToken: 'new', refreshToken: 'new-refresh' }))
        .mockResolvedValueOnce(response(200));
      await expect(api.get('/users/me')).resolves.toEqual({});
    },
  );

  it('shares one refresh and replaces an explicitly supplied stale Authorization header', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh'))
        return response(200, { accessToken: 'new', refreshToken: 'new-refresh' });
      return response(new Headers(init.headers).get('Authorization') === 'Bearer new' ? 200 : 401);
    });
    vi.stubGlobal('fetch', fetch);
    const { api } = await import('@/shared/api/client');
    await Promise.all([api.get('/users/me', 'old'), api.get('/preferences', 'old')]);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(clear).not.toHaveBeenCalled();
  });

  it('clears a revoked session, but preserves a session on invalid login credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(401)),
    );
    const { api } = await import('@/shared/api/client');
    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ status: 401 });
    expect(clear).not.toHaveBeenCalled();
    await expect(api.get('/users/me')).rejects.toMatchObject({ status: 401 });
    expect(clear).toHaveBeenCalledWith('expired');
  });

  it('preserves a generation idempotency key through token refresh', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { accessToken: 'new', refreshToken: 'new-refresh' }))
      .mockResolvedValueOnce(response(202, { id: 'trip-1' }));
    vi.stubGlobal('fetch', fetch);
    const { api } = await import('@/shared/api/client');
    await api.post('/main-planner/trips', { title: '서울' }, undefined, {
      'Idempotency-Key': 'create-1',
    });
    const requests = fetch.mock.calls.filter(([url]) =>
      String(url).endsWith('/main-planner/trips'),
    );
    expect(requests).toHaveLength(2);
    for (const [, init] of requests) {
      expect(new Headers(init.headers).get('Idempotency-Key')).toBe('create-1');
    }
  });

  it('shows the admission reason and preserves Retry-After for an active generation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 'USER_GENERATION_LIMIT',
              message: '진행 중인 일정 생성이 있어요. 완료하거나 취소한 뒤 다시 요청해주세요.',
            }),
            { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } },
          ),
      ),
    );
    const { api } = await import('@/shared/api/client');
    await expect(api.post('/main-planner/trips', {})).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 30,
      message: '진행 중인 일정 생성이 있어요. 완료하거나 취소한 뒤 다시 요청해주세요.',
    });
  });
});
