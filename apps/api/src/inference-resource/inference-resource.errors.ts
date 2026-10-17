import { isInferenceDispatchRejection } from './inference-execution-context';

export type InferenceResourceErrorCode =
  | 'RESOURCE_QUEUE_FULL'
  | 'RESOURCE_WAIT_TIMEOUT'
  | 'RESOURCE_RECONCILIATION_REQUIRED'
  | 'MODEL_COMPLETION_UNCERTAIN';

/** Must escape model fallbacks: the resource can still be occupied by a remote call. */
export class InferenceResourceError extends Error {
  constructor(
    readonly code: InferenceResourceErrorCode,
    readonly resourceKey: string,
    readonly executionId?: string,
  ) {
    super(`${code}: ${resourceKey}${executionId ? ` (${executionId})` : ''}`);
    this.name = 'InferenceResourceError';
  }
}

export function shouldPropagateInferenceError(error: unknown): boolean {
  return error instanceof InferenceResourceError || isInferenceDispatchRejection(error);
}
