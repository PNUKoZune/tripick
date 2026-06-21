import type { InboxItemDto, InboxSummaryDto } from '@tripick/types';

import { api } from '@/shared/lib';

export function fetchInbox() {
  return api.get<InboxSummaryDto>('/inbox');
}

export function markInboxRead(id: string) {
  return api.patch<InboxItemDto>(`/inbox/${id}/read`, {});
}

export function markAllInboxRead() {
  return api.post<{ updated: number }>('/inbox/read-all', {});
}
