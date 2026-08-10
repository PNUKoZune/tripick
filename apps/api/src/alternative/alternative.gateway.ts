import { Injectable } from '@nestjs/common';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { ReplanResultDto } from '@tripick/types';

/**
 * Alternative WebSocket push 유틸
 * RealtimeGateway를 래핑해 Alternative 도메인 컨텍스트에서 사용
 */
@Injectable()
export class AlternativeGateway {
  constructor(private readonly realtimeGateway: RealtimeGateway) {}

  pushAlternativePlan(result: ReplanResultDto) {
    this.realtimeGateway.pushReplanResult(result);
  }
}
