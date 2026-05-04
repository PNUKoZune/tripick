export type ReplanTrigger = 'waiting' | 'deviation' | 'weather' | 'manual';
export type ReplanStatus = 'pending' | 'processing' | 'completed' | 'failed';
export interface ReplanRequestDto {
    tripId: string;
    trigger: ReplanTrigger;
    currentLocation?: {
        lat: number;
        lng: number;
    };
    /** 웨이팅 예상 시간 (분) */
    waitingMinutes?: number;
    /** 이탈한 일정 항목 ID */
    deviatedItemId?: string;
    context?: Record<string, unknown>;
}
export interface ReplanJobDto {
    jobId: string;
    tripId: string;
    trigger: ReplanTrigger;
    status: ReplanStatus;
    createdAt: string;
}
export interface ReplanResultDto {
    jobId: string;
    tripId: string;
    status: ReplanStatus;
    updatedItems?: import('./itinerary').ItineraryItemDto[];
    explanation?: string;
    completedAt?: string;
}
/** WebSocket 이벤트 페이로드 */
export interface WsReplanResultEvent {
    event: 'replan_result';
    data: ReplanResultDto;
}
//# sourceMappingURL=replanning.d.ts.map