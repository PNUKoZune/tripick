import { test, expect } from '@playwright/test';

test('signup, verify, login, edit itinerary, recover session and logout', async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const email = `browser-${info.project.name}-${Date.now()}@tripick.test`;
  const password = 'Browser-test123';
  await page.goto('/signup');
  await page.getByRole('button', { name: '전체 동의', exact: true }).click();
  await page.getByRole('button', { name: '동의하고 계속', exact: true }).click();
  await page.getByLabel('닉네임', { exact: true }).fill('브라우저 여행자');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel(/^비밀번호/).fill(password);
  const signup = page.waitForResponse((response) => response.url().endsWith('/auth/signup'));
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  expect((await signup).status()).toBe(200);
  await expect
    .poll(async () =>
      (
        await request.get(`http://127.0.0.1:4310/__test/mail?email=${encodeURIComponent(email)}`)
      ).status(),
    )
    .toBe(200);
  const { link } = await (
    await request.get(`http://127.0.0.1:4310/__test/mail?email=${encodeURIComponent(email)}`)
  ).json();
  const verification = new URL(link);
  await page.goto(`${verification.pathname}${verification.search}`);
  await expect(page.getByText(/인증.*완료|인증.*되었|인증.*됐/).first()).toBeVisible();
  await page.getByRole('link', { name: '로그인하러 가기', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 여행', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '나중에 하기', exact: true }).click();
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '프로필', exact: true })).toBeVisible();

  const session = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tripick.session.v1')!),
  );
  const tripResponse = await request.post('/api/v1/main-planner/trips', {
    headers: { Authorization: `Bearer ${session.tokens.accessToken}` },
    data: {
      title: '브라우저 일정',
      destination: '부산',
      startDate: '2030-09-10',
      endDate: '2030-09-10',
      startTime: '09:00',
      endTime: '21:00',
      members: [],
    },
    timeout: 60_000,
  });
  expect(tripResponse.status(), await tripResponse.text()).toBe(202);
  const trip = await tripResponse.json();
  // Recover the real queued job through the same URL used after create/reload.
  await page.goto(`/trips/new?generationTripId=${trip.id}`);
  await expect(page).toHaveURL(`/planner?tripId=${trip.id}`, { timeout: 60_000 });
  await page.getByRole('button', { name: '수정', exact: true }).first().click();
  await page.getByLabel('메모', { exact: true }).fill('브라우저 E2E 저장 확인');
  const saved = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.url().includes('/items/'),
  );
  await page.getByRole('button', { name: '저장', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /브라우저 E2E 저장 확인/ })).toBeVisible();

  // A real 401 from the API must rotate the refresh token and recover the settings page.
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('tripick.session.v1')!);
    stored.tokens.accessToken = 'expired-access-token';
    localStorage.setItem('tripick.session.v1', JSON.stringify(stored));
  });
  const refreshed = page.waitForResponse((response) => response.url().endsWith('/auth/refresh'));
  await page.goto('/settings');
  expect((await refreshed).status()).toBe(200);
  await expect(page.getByRole('heading', { name: '프로필', exact: true })).toBeVisible();
  const current = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tripick.session.v1')!),
  );
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('tripick.session.v1')))
    .toBeNull();
  expect(
    (
      await request.get('/api/v1/users/me', {
        headers: { Authorization: `Bearer ${current.tokens.accessToken}` },
      })
    ).status(),
  ).toBe(401);
  expect(errors).toEqual([]);
});

test('protected routes redirect anonymous users to login', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
});
