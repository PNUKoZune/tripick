// TriPick 웹앱 구동/스크린샷 드라이버 (에이전트용 하네스)
//
// 이 앱의 화면 대부분은 로그인 세션 + 실제 여행 데이터가 있어야 렌더된다
// (SessionGuard + API 로드). 그래서 정적 GET 으로는 UI 를 볼 수 없고,
// 이 드라이버가 ① 데모 로그인으로 세션을 발급받아 ② localStorage 에 주입한 뒤
// ③ 원하는 경로를 헤드리스 Chromium 으로 열어 스크린샷을 찍는다.
//
// 사용법:
//   node driver.mjs                                  # 스모크: planner 재계획 배너 검증 + 스크린샷
//   node driver.mjs "/trips" trips.png               # 임의 경로 스크린샷 (로그인만 필요)
//   node driver.mjs "/planner?tripId=$TRIP_ID&day=1&replan=weather" out.png
//
// 환경변수:
//   WEB_BASE   (기본 http://localhost:3000)
//   API_BASE   (기본 http://127.0.0.1:4000)
//   TRIP_ID    스모크 모드에서 배너를 띄울 여행 id (seed:demo-live 출력값)
//   NICKNAME   데모 계정 닉네임 (기본 "드라이버")
//   VIEWPORT   "WxH" (기본 430x880 — 모바일 폭)
//
// 출력 스크린샷은 이 스킬 디렉터리의 shots/ 아래에 떨어진다.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:3000';
const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:4000';
const NICKNAME = process.env.NICKNAME ?? '드라이버';
const [vw, vh] = (process.env.VIEWPORT ?? '430x880').split('x').map(Number);

const SESSION_KEY = 'tripick.session.v1'; // apps/web/src/shared/lib/session-token.ts

async function demoLogin() {
  const res = await fetch(`${API_BASE}/api/v1/auth/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: NICKNAME }),
  });
  if (!res.ok) throw new Error(`demo login failed: ${res.status} ${await res.text()}`);
  const session = await res.json(); // LoginResponseDto: { tokens, user }
  if (!session?.tokens?.accessToken) throw new Error('no accessToken in demo login response');
  return session;
}

async function main() {
  const argPath = process.argv[2];
  const argOut = process.argv[3];
  const session = await demoLogin();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: vw || 430, height: vh || 880 },
    // SCHEME=dark 로 prefers-color-scheme 다크 화면을 그대로 찍는다(테마 토글 UI 가 없으므로).
    colorScheme: process.env.SCHEME === 'dark' ? 'dark' : 'light',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`[console.error] ${m.text()}`));

  // 세션 주입: origin 을 먼저 로드해야 localStorage 에 쓸 수 있다
  await page.goto(WEB_BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
    [SESSION_KEY, session],
  );

  let exitCode = 0;

  if (argPath) {
    // 임의 경로 스크린샷 모드
    await page.goto(`${WEB_BASE}${argPath}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    // SCROLL_Y=1800 처럼 특정 지점을 뷰포트로 찍고 싶을 때(긴 폼의 중간 검수).
    if (process.env.SCROLL_Y) {
      await page.evaluate((y) => window.scrollTo(0, Number(y)), process.env.SCROLL_Y);
      await page.waitForTimeout(400);
    }
    const out = path.join(SHOTS, argOut ?? 'shot.png');
    // FULL_PAGE=1 이면 스크롤 전체를 한 장으로(긴 폼 화면 검수용).
    await page.screenshot({ path: out, fullPage: process.env.FULL_PAGE === '1' });
    console.log(`✅ screenshot → ${out}`);
  } else {
    // 스모크 모드: planner 재계획 배너(알림 딥링크) 검증
    const tripId = process.env.TRIP_ID;
    if (!tripId) throw new Error('스모크 모드엔 TRIP_ID 필요 — `pnpm --filter @tripick/api seed:demo-live` 출력값을 넣어라');

    const checks = {};
    for (const trigger of ['weather', 'crowd', 'deviation']) {
      await page.goto(`${WEB_BASE}/planner?tripId=${tripId}&day=1&replan=${trigger}`, {
        waitUntil: 'networkidle',
      });
      const banner = page.locator('div.fixed.z-40').filter({ hasText: '일정을 다시 짜볼까요' });
      const visible = await banner
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      await page.screenshot({ path: path.join(SHOTS, `banner-${trigger}.png`) });
      checks[trigger] = visible;
    }

    // 닫기 → 배너 사라짐 + 모달 안 열림(= 재계획 잡 안 걸림)
    await page.goto(`${WEB_BASE}/planner?tripId=${tripId}&day=1&replan=weather`, { waitUntil: 'networkidle' });
    const banner = page.locator('div.fixed.z-40').filter({ hasText: '일정을 다시 짜볼까요' });
    await banner.waitFor({ state: 'visible', timeout: 15000 });
    await banner.getByRole('button', { name: '닫기', exact: true }).click();
    await page.waitForTimeout(500);
    checks.dismissRemovesBanner = (await banner.count()) === 0;
    checks.dismissKeepsModalClosed = !(await page.getByText('어떻게 바꿀까요?').isVisible().catch(() => false));
    await page.screenshot({ path: path.join(SHOTS, 'banner-dismissed.png') });

    // 배너 "AI 재계획" → 모달 열림 + 배너 사라짐
    await page.goto(`${WEB_BASE}/planner?tripId=${tripId}&day=1&replan=crowd`, { waitUntil: 'networkidle' });
    await banner.waitFor({ state: 'visible', timeout: 15000 });
    await banner.getByRole('button', { name: 'AI 재계획' }).click();
    checks.replanOpensModal = await page
      .getByText('어떻게 바꿀까요?')
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    await page.screenshot({ path: path.join(SHOTS, 'banner-to-modal.png') });

    console.log(JSON.stringify(checks, null, 2));
    const allPass = Object.values(checks).every(Boolean);
    console.log(allPass ? '✅ 모든 배너 검증 통과' : '❌ 실패한 검증 있음');
    console.log(`shots → ${SHOTS}`);
    if (!allPass) exitCode = 1;
  }

  if (errors.length) {
    console.log('--- page errors ---');
    console.log(errors.slice(0, 20).join('\n'));
  }
  await browser.close();
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
