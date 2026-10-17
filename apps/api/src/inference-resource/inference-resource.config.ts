import type { ConfigService } from '@nestjs/config';

export type InferenceWorkload = 'chat' | 'vision' | 'embedding';
export type InferenceDevice = 'cpu' | 'gpu' | 'external' | 'unspecified';
export interface InferenceResourceRoute {
  resourceKey: string;
  device: InferenceDevice;
}

export interface InferenceResourceConfig {
  routes: Record<InferenceWorkload, InferenceResourceRoute>;
  maxWaiting: number;
  waitTimeoutMs: number;
  pollMs: number;
  heartbeatMs: number;
  staleAfterMs: number;
}

export function readInferenceResourceConfig(config: ConfigService): InferenceResourceConfig {
  const positive = (key: string, fallback: number, maximum: number): number => {
    const value = Number(config.get<string | number>(key, fallback));
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`${key} must be an integer between 1 and ${maximum}`);
    }
    return value;
  };
  const route = (prefix: string, fallback: InferenceResourceRoute): InferenceResourceRoute => {
    const explicitKey = config.get<string>(`${prefix}_RESOURCE_KEY`);
    const resourceKey = explicitKey ?? fallback.resourceKey;
    const device = config.get<InferenceDevice>(`${prefix}_RESOURCE_DEVICE`, fallback.device);
    if (!/^[A-Za-z0-9:_-]{1,120}$/.test(resourceKey)) {
      throw new Error(`${prefix}_RESOURCE_KEY must contain 1-120 letters, digits, :, _ or -`);
    }
    if (!['cpu', 'gpu', 'external', 'unspecified'].includes(device)) {
      throw new Error(`${prefix}_RESOURCE_DEVICE must be cpu, gpu, external or unspecified`);
    }
    if (device === 'external' && !explicitKey && fallback.device !== 'external') {
      throw new Error(`${prefix}_RESOURCE_KEY must be explicit for an external provider`);
    }
    return { resourceKey, device };
  };

  // Keys describe configured ownership, never guessed from hostname, port, or model name.
  const chat = route('LLM_CHAT', { resourceKey: 'llama-cpp:shared', device: 'unspecified' });
  const routes = {
    chat,
    vision: route('LLM_VISION', chat),
    embedding: route('LLM_EMBEDDING', { resourceKey: 'embedding:default', device: 'unspecified' }),
  };
  const devices = new Map<string, InferenceDevice>();
  for (const entry of Object.values(routes)) {
    const previous = devices.get(entry.resourceKey);
    if (previous && previous !== entry.device) {
      throw new Error(`Conflicting device configuration for resource ${entry.resourceKey}`);
    }
    devices.set(entry.resourceKey, entry.device);
  }
  const heartbeatMs = positive('INFERENCE_RESOURCE_HEARTBEAT_MS', 5000, 60000);
  const staleAfterMs = positive('INFERENCE_RESOURCE_STALE_AFTER_MS', 30000, 3600000);
  if (staleAfterMs < heartbeatMs * 3) {
    throw new Error('INFERENCE_RESOURCE_STALE_AFTER_MS must be at least 3 heartbeat intervals');
  }
  return {
    routes,
    maxWaiting: positive('INFERENCE_RESOURCE_MAX_WAITING', 8, 1000),
    waitTimeoutMs: positive('INFERENCE_RESOURCE_WAIT_TIMEOUT_MS', 180000, 3600000),
    pollMs: positive('INFERENCE_RESOURCE_POLL_MS', 250, 10000),
    heartbeatMs,
    staleAfterMs,
  };
}
