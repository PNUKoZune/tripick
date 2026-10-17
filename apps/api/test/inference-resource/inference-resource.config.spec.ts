/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import { readInferenceResourceConfig } from '../../src/inference-resource/inference-resource.config';
import {
  assertInferenceExecutionRunnable,
  getInferenceExecutionContext,
  runWithInferenceExecutionContext,
} from '../../src/inference-resource/inference-execution-context';
import { shouldPropagateInferenceError } from '../../src/inference-resource/inference-resource.errors';

describe('inference resource configuration', () => {
  it('shares chat/vision independently of endpoints and isolates the embedding default', () => {
    const config = readInferenceResourceConfig(new ConfigService({
      LLM_BASE_URL: 'https://external.invalid/v1',
      LLM_VISION_BASE_URL: 'http://another-host:9898/v1',
    }));
    expect(config.routes.chat).toEqual(config.routes.vision);
    expect(config.routes.chat.device).toBe('unspecified');
    expect(config.routes.embedding.resourceKey).not.toBe(config.routes.chat.resourceKey);
  });

  it('requires an explicit resource key for an external provider', () => {
    expect(() => readInferenceResourceConfig(new ConfigService({
      LLM_CHAT_RESOURCE_DEVICE: 'external',
    }))).toThrow('must be explicit');
    const config = readInferenceResourceConfig(new ConfigService({
      LLM_CHAT_RESOURCE_DEVICE: 'external', LLM_CHAT_RESOURCE_KEY: 'provider:chat',
      LLM_VISION_RESOURCE_DEVICE: 'gpu', LLM_VISION_RESOURCE_KEY: 'gpu:llama',
    }));
    expect(config.routes.chat.resourceKey).not.toBe(config.routes.vision.resourceKey);
  });

  it('rejects a key assigned to conflicting devices', () => {
    expect(() => readInferenceResourceConfig(new ConfigService({
      LLM_CHAT_RESOURCE_DEVICE: 'gpu',
      LLM_EMBEDDING_RESOURCE_KEY: 'llama-cpp:shared',
      LLM_EMBEDDING_RESOURCE_DEVICE: 'cpu',
    }))).toThrow('Conflicting device');
  });

  it.each([
    { INFERENCE_RESOURCE_MAX_WAITING: '0' },
    { INFERENCE_RESOURCE_WAIT_TIMEOUT_MS: 'NaN' },
    { INFERENCE_RESOURCE_HEARTBEAT_MS: '500', INFERENCE_RESOURCE_STALE_AFTER_MS: '1000' },
    { LLM_CHAT_RESOURCE_KEY: 'with spaces' },
    { LLM_EMBEDDING_RESOURCE_DEVICE: 'cuda' },
  ])('fails closed on invalid resource configuration %j', (settings) => {
    expect(() => readInferenceResourceConfig(new ConfigService(settings))).toThrow();
  });

  it('propagates cancellation with the original identity through model fallbacks', async () => {
    const cancelled = new Error('cancelled');
    await runWithInferenceExecutionContext({
      requestId: 'request-a', attempt: 2, assertRunnable: async () => { throw cancelled; },
    }, async () => {
      expect(getInferenceExecutionContext()?.requestId).toBe('request-a');
      await expect(assertInferenceExecutionRunnable()).rejects.toBe(cancelled);
      expect(shouldPropagateInferenceError(cancelled)).toBe(true);
    });
    expect(getInferenceExecutionContext()).toBeUndefined();
  });
});
