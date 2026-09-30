import { test, expect, type Page } from '@playwright/test';

const PHOTO_KEY = 'preferences/photo-test/beach.png';
const photoUrl = (version: number) => `/__test/photos/beach.png?signature=${version}`;
const profile = {
  sleepTime: '23:00',
  wakeTime: '07:30',
  likedThemes: ['beach'],
  dislikedThemes: [],
  pace: 'balanced',
  activityIntensity: 'moderate',
  crowdPreference: 'balanced',
};

async function openPreferences(page: Page, withProfile = true) {
  let reads = 0;
  await page.clock.install();
  await page.addInitScript(() => {
    localStorage.setItem(
      'tripick.session.v1',
      JSON.stringify({
        user: { id: 'photo-test', nickname: '사진 테스트' },
        tokens: { accessToken: 'test-access', refreshToken: 'test-refresh' },
      }),
    );
  });
  await page.route('**/api/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/v1/preferences') {
      reads += 1;
      return route.fulfill({
        json: {
          id: 'preference-test',
          userId: 'photo-test',
          profile: withProfile ? profile : null,
          photos: [{ key: PHOTO_KEY, url: photoUrl(reads) }],
        },
      });
    }
    if (pathname === '/api/v1/inbox') {
      return route.fulfill({ json: { items: [], unreadCount: 0 } });
    }
    return route.fulfill({ json: [] });
  });
  await page.route('**/__test/photos/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await page.goto('/preferences');
  await expect(page.getByRole('heading', { name: '취향', exact: true })).toBeVisible();
  return { reads: () => reads };
}

async function setVisible(page: Page, visible: boolean) {
  await page.evaluate((nextVisible) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: nextVisible ? 'visible' : 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  }, visible);
}

test('refreshes photo URLs while open and keeps the lightbox and unsaved form current', async ({
  page,
}) => {
  const api = await openPreferences(page);
  const thumbnail = page.getByRole('button', { name: '사진 크게 보기' }).first();
  await expect(thumbnail.locator('img')).toHaveAttribute('src', photoUrl(1));
  await page.getByLabel('기상', { exact: true }).fill('08:45');
  await thumbnail.click();
  const lightbox = page.getByRole('dialog', { name: '이미지 확대 보기' });

  await page.clock.fastForward(5 * 60 * 1000 + 1000);

  await expect.poll(api.reads).toBeGreaterThan(1);
  await expect(thumbnail.locator('img')).toHaveAttribute('src', photoUrl(api.reads()));
  await expect(lightbox.locator('img')).toHaveAttribute('src', photoUrl(api.reads()));
  await lightbox.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByLabel('기상', { exact: true })).toHaveValue('08:45');
});

test('refreshes expired photo URLs on return from the background', async ({ page }) => {
  const api = await openPreferences(page);
  const thumbnail = page.getByRole('button', { name: '사진 크게 보기' }).first().locator('img');
  await expect(thumbnail).toHaveAttribute('src', photoUrl(1));
  await setVisible(page, false);
  await page.clock.fastForward(16 * 60 * 1000);
  expect(api.reads()).toBe(1);

  await setVisible(page, true);

  await expect.poll(api.reads).toBeGreaterThan(1);
  await expect(thumbnail).toHaveAttribute('src', photoUrl(api.reads()));
  await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
});

test('shows saved photos even before a preference profile has been filled in', async ({ page }) => {
  await openPreferences(page, false);
  await expect(
    page.getByRole('button', { name: '사진 크게 보기' }).first().locator('img'),
  ).toHaveAttribute('src', photoUrl(1));
});
