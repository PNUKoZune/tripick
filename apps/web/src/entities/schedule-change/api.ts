import type {
  CreateScheduleChangeDto,
  ScheduleChangeListDto,
  ScheduleChangeProposalDto,
} from '@tripick/types';

import { api } from '@/shared/lib';

/** 일정 변경 제안 생성 (비-owner 참여자 → owner 승인 대기) */
export function createScheduleChange(body: CreateScheduleChangeDto) {
  return api.post<ScheduleChangeProposalDto>('/schedule-changes', body);
}

/** 트립의 대기중 제안 목록 (owner: 전체 / 참여자: 본인) */
export function fetchScheduleChanges(tripId: string) {
  return api.get<ScheduleChangeListDto>(
    `/schedule-changes?tripId=${encodeURIComponent(tripId)}`,
  );
}

/** 제안 단건 (owner diff 미리보기) */
export function fetchScheduleChange(id: string) {
  return api.get<ScheduleChangeProposalDto>(`/schedule-changes/${id}`);
}

/** 제안 승인 (owner) */
export function approveScheduleChange(id: string) {
  return api.post<ScheduleChangeProposalDto>(`/schedule-changes/${id}/approve`, {});
}

/** 제안 거절 (owner) */
export function rejectScheduleChange(id: string) {
  return api.post<ScheduleChangeProposalDto>(`/schedule-changes/${id}/reject`, {});
}

/** 제안 취소 (요청자 본인) */
export function cancelScheduleChange(id: string) {
  return api.delete<void>(`/schedule-changes/${id}`);
}
