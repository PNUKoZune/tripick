import { AsyncLocalStorage } from 'node:async_hooks';

export interface InferenceExecutionContext {
  requestId: string;
  attempt: number;
  assertRunnable?: () => Promise<void>;
}

const context = new AsyncLocalStorage<InferenceExecutionContext>();
const dispatchRejections = new WeakSet<object>();

/** Propagates the durable job identity into every nested model call, including embeddings. */
export function runWithInferenceExecutionContext<T>(
  value: InferenceExecutionContext,
  operation: () => T,
): T {
  return context.run(value, operation);
}

export function getInferenceExecutionContext(): InferenceExecutionContext | undefined {
  return context.getStore();
}

/** Keeps the original cancellation/deadline error instance, while preventing model fallbacks. */
export async function assertInferenceExecutionRunnable(): Promise<void> {
  try {
    await context.getStore()?.assertRunnable?.();
  } catch (error) {
    if (typeof error === 'object' && error !== null) dispatchRejections.add(error);
    throw error;
  }
}

export function isInferenceDispatchRejection(error: unknown): boolean {
  return typeof error === 'object' && error !== null && dispatchRejections.has(error);
}
