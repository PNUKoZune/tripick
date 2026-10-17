import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TripGenerationJobDto } from '@tripick/types';

import { TripCreateLoading } from '@/views/trip-create/ui/trip-create-loading';

function renderJob(overrides: Partial<TripGenerationJobDto>, retryAfter = 0) {
  return renderToStaticMarkup(
    createElement(TripCreateLoading, {
      job: {
        tripId: 'trip-1',
        status: 'processing',
        stage: 'building_itinerary',
        progress: 60,
        attempt: 1,
        maxAttempts: 3,
        ...overrides,
      },
      loadingStatus: false,
      connectionError: null,
      retrying: false,
      retryAfter,
      retryError: null,
      cancelling: false,
      cancelError: null,
      onRetry: vi.fn(),
      onCancel: vi.fn(),
      onRefresh: vi.fn(),
    }),
  );
}

describe('generation lifecycle screen', () => {
  it('shows cancellation only when the server grants permission', () => {
    expect(renderJob({ canCancel: true })).toContain('일정 생성 취소');
    expect(renderJob({ canCancel: false })).not.toContain('일정 생성 취소');
  });

  it.each([
    ['cancel_requested', '일정 생성 취소를 요청했어요'],
    ['reconciling', '작업 종료를 확인하고 있어요'],
    ['cancelled', '일정 생성을 취소했어요'],
  ] as const)('does not imply ongoing progress when %s', (status, title) => {
    const html = renderJob({ status, canCancel: false });
    expect(html).toContain(title);
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('AI 일정 다시 만들기');
  });

  it('keeps failed retries disabled during Retry-After', () => {
    const html = renderJob({ status: 'failed' }, 30);
    expect(html).toContain('30초 후 다시 요청');
    expect(html).toContain('disabled=""');
  });
});
