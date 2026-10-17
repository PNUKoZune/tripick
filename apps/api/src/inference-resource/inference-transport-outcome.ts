function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

/**
 * Node connect/getaddrinfo failures prove this request never reached the model.
 * A bare code or socket.bytesWritten is insufficient: Node counts buffered writes before connect.
 */
export function isConfirmedConnectionFailure(error: unknown): boolean {
  const failure = record(error);
  if (!failure || failure.isAxiosError !== true || failure.response != null) return false;
  const config = record(failure.config);
  const cause = record(failure.cause);
  if (config?.maxRedirects !== 0 || !cause || cause.code !== failure.code) return false;
  if (failure.code === 'ECONNREFUSED') return cause.syscall === 'connect';
  if (failure.code === 'ENOTFOUND' || failure.code === 'EAI_AGAIN') return cause.syscall === 'getaddrinfo';
  return false;
}
