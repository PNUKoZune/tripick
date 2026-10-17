import type { ConfigService } from '@nestjs/config';
import { TextEmbeddingService } from '../../src/embedding/text-embedding.service';
import { PlannerAgentService } from '../../src/planner/agent/planner-agent.service';
import { VisionAnalyzer } from '../../src/preference-analyzer/vision.analyzer';
import type { InferenceResourceService } from '../../src/inference-resource/inference-resource.service';
import type { InferenceWorkload } from '../../src/inference-resource/inference-resource.config';

/** Model parsing tests explicitly replace the DB gate; production DI never bypasses it. */
export function modelTestGate(): InferenceResourceService {
  return {
    execute: <T>(_workload: InferenceWorkload, operation: () => Promise<T>) => operation(),
  } as InferenceResourceService;
}

export const createTestPlannerAgent = (config: ConfigService): PlannerAgentService =>
  new PlannerAgentService(config, modelTestGate());
export const createTestVisionAnalyzer = (config: ConfigService): VisionAnalyzer =>
  new VisionAnalyzer(config, modelTestGate());
export const createTestTextEmbedding = (config: ConfigService): TextEmbeddingService =>
  new TextEmbeddingService(config, modelTestGate());
