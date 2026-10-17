import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

export class GenerationNotRunnableError extends Error {
  constructor(message = '일정 생성 실행권이 종료되었거나 취소되었습니다.') { super(message); this.name = 'GenerationNotRunnableError'; }
}

export class GenerationAdmissionException extends HttpException {
  readonly retryAfter = 30;
  constructor(code: 'USER_GENERATION_LIMIT' | 'GENERATION_QUEUE_FULL' | 'GENERATION_ADMISSION_PAUSED') {
    const status = code === 'GENERATION_ADMISSION_PAUSED' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.TOO_MANY_REQUESTS;
    super({ statusCode: status, code, retryAfter: 30,
      message: code === 'USER_GENERATION_LIMIT' ? '진행 중인 일정 생성이 있어요. 완료하거나 취소한 뒤 다시 요청해주세요.' : code === 'GENERATION_ADMISSION_PAUSED' ? '일정 생성 접수를 잠시 중단했어요. 잠시 후 다시 요청해주세요.' : '일정 생성 대기가 가득 찼어요. 잠시 후 다시 요청해주세요.',
    }, status);
  }
}

/** Nest's default HttpException handling does not copy custom retry metadata into headers. */
@Catch(GenerationAdmissionException)
export class GenerationAdmissionFilter implements ExceptionFilter {
  catch(exception: GenerationAdmissionException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Retry-After', String(exception.retryAfter));
    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
