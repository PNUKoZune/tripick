/**
 * 일정 변경 승인(invitee change approval) 전용 DTO.
 *
 * owner 가 아닌 여행 참여자(companion)가 일정 변경(추가·삭제·수정·순서변경·대안 swap·AI 재계획)을
 * 시도하면 즉시 반영하지 않고 "제안(ScheduleChangeProposal)" 으로 저장한다. owner 가 승인해야
 * 그때 owner 권한으로 실제 변경이 실행된다. 알림은 trip_invite 수락/거절 패턴을 따른다.
 */

import type {
  PlannerAddItemRequestDto,
  PlannerReorderItemsRequestDto,
  PlannerSwapRequestDto,
  PlannerUpdateItemRequestDto,
} from './main-planner';
import type { ReplanRequestDto } from './replanning';

export type ScheduleChangeKind =
  | 'add_item'
  | 'update_item'
  | 'delete_item'
  | 'reorder_items'
  | 'swap'
  | 'replan';

export type ScheduleChangeStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'failed';

/**
 * 제안 payload — kind 로 분기되는 discriminated union.
 * 각 payload 는 owner 가 승인할 때 그대로 기존 서비스 메서드에 재전달(replay)된다.
 * replan 의 tripId 는 상위 proposal.tripId 로 강제되므로 여기선 생략(Omit).
 */
export type ScheduleChangePayload =
  | { kind: 'add_item'; body: PlannerAddItemRequestDto }
  | { kind: 'update_item'; itemId: string; body: PlannerUpdateItemRequestDto }
  | { kind: 'delete_item'; itemId: string }
  | { kind: 'reorder_items'; body: PlannerReorderItemsRequestDto }
  | { kind: 'swap'; body: PlannerSwapRequestDto }
  | { kind: 'replan'; body: Omit<ReplanRequestDto, 'tripId'> };

export interface ScheduleChangeRequesterDto {
  id: string;
  nickname: string;
}

export interface ScheduleChangeProposalDto {
  id: string;
  tripId: string;
  requester: ScheduleChangeRequesterDto;
  kind: ScheduleChangeKind;
  /** 사람이 읽는 한 줄 요약 (예: `2일차에 "성산일출봉" 추가`) */
  summary: string;
  /** 원본 요청 payload — owner diff 미리보기·승인 replay 에 사용 */
  payload: ScheduleChangePayload;
  status: ScheduleChangeStatus;
  /** 제안 대상 일차(있으면 딥링크·미리보기용) */
  day?: number;
  /** 제안 대상 일정 항목 id(있으면 미리보기 하이라이트용) */
  targetItemId?: string;
  createdAt: string;
  resolvedAt?: string;
}

/** POST /schedule-changes 본문 — payload 는 kind 별 union */
export interface CreateScheduleChangeDto {
  tripId: string;
  payload: ScheduleChangePayload;
}

export interface ScheduleChangeListDto {
  proposals: ScheduleChangeProposalDto[];
}
