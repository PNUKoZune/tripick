/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { DataSource } from 'typeorm';
import { TextEmbeddingService } from '../../src/embedding/text-embedding.service';
import { PlannerAgentService } from '../../src/planner/agent/planner-agent.service';
import { VisionAnalyzer } from '../../src/preference-analyzer/vision.analyzer';
import { InferenceResourceError } from '../../src/inference-resource/inference-resource.errors';
import { InferenceResourceService, type ReconciliationEvidence } from '../../src/inference-resource/inference-resource.service';

jest.mock('axios');

describe('mandatory model dispatch boundary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('propagates quarantined resources from all three callers without HTTP or fallback success', async () => {
    const blocked = new InferenceResourceError('RESOURCE_RECONCILIATION_REQUIRED', 'gpu:shared');
    const execute = jest.fn().mockRejectedValue(blocked);
    const gate = { execute } as unknown as InferenceResourceService;
    const config = new ConfigService({ LLM_PLANNER_ENABLED: 'true' });

    await expect(new TextEmbeddingService(config, gate).embed('test')).rejects.toBe(blocked);
    await expect(new VisionAnalyzer(config, gate).analyzePhoto('data:image/png;base64,AAAA')).rejects.toBe(blocked);
    await expect(new PlannerAgentService(config, gate).plan({
      destination: '서울', dayDates: ['2026-10-18'], wakeTime: '09:00', sleepTime: '21:00',
      transportMode: 'transit', dayCount: 1, minimumItemsPerDay: 1, itemsPerDay: 1,
      candidates: [], weatherHint: '',
    })).rejects.toBe(blocked);

    expect(execute.mock.calls.map((args: unknown[]) => args[0])).toEqual(['embedding', 'vision', 'chat']);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('never dispatches when durable ownership cannot be acquired', async () => {
    const db = { transaction: jest.fn().mockRejectedValue(new Error('database unavailable')) } as unknown as DataSource;
    const gate = new InferenceResourceService(db, new ConfigService({}));
    const operation = jest.fn().mockResolvedValue('unexpected');
    await expect(gate.execute('chat', operation)).rejects.toMatchObject({
      code: 'RESOURCE_RECONCILIATION_REQUIRED',
    });
    expect(operation).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { ownerStopped: false, ownerStopReference: 'terminated pod uid/example' },
    { ownerStopped: true },
    { ownerStopped: true, ownerStopReference: 'short' },
  ])('requires previous executor termination evidence before touching DB %j', async (ownerEvidence) => {
    const transaction = jest.fn();
    const db = { transaction } as unknown as DataSource;
    const gate = new InferenceResourceService(db, new ConfigService({}));
    await expect(gate.reconcile({
      resourceKey: 'gpu:shared', executionId: 'execution', actor: 'operator',
      confirmation: 'model-server-restarted', reference: 'model-server restart abc123',
      ...ownerEvidence,
    } as ReconciliationEvidence)).rejects.toThrow('previous owner process termination');
    expect(transaction).not.toHaveBeenCalled();
  });
});
