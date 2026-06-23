import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * 전역 ThrottlerGuard. HTTP 요청에만 적용하고 WebSocket·기타 컨텍스트는 통과시킨다.
 * (기본 ThrottlerGuard 는 express req/res 를 가정해서 WS 메시지 핸들러에서 깨질 수 있음)
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return super.canActivate(context);
  }
}
