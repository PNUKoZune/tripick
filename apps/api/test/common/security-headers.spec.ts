/// <reference types="jest" />

import express from 'express';
import request from 'supertest';
import { securityHeaders } from '../../src/common/security-headers';

/**
 * 미들웨어만 단독으로 태운다 — 전체 앱을 부팅하면 BullMQ 워커와 알림 스캔 잡까지 함께
 * 돌아서 실제 인박스·FCM 알림이 나갈 수 있다.
 */
function harness() {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.get('/anything', (_req, res) => res.json({ ok: true }));
  app.get('/redirect', (_req, res) => res.redirect('https://example.test/'));
  return request(app);
}

describe('securityHeaders', () => {
  it('JSON 응답에 세 헤더를 붙인다', async () => {
    const res = await harness().get('/anything').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  /**
   * 카카오 OAuth 시작·콜백은 API 오리진에서 열리는 top-level 문서(302)라 웹(Next) 쪽
   * headers() 가 닿지 않는다 — 리다이렉트 응답에도 붙어야 한다.
   */
  it('리다이렉트 응답에도 붙는다', async () => {
    const res = await harness().get('/redirect').expect(302);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('서버 스택을 광고하지 않는다', async () => {
    const res = await harness().get('/anything').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
