import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PreferenceAnalysisService } from './preference-analysis.service';
import {
  ANALYZE_PHOTOS_JOB,
  PREFERENCE_ANALYSIS_QUEUE,
  type AnalyzePhotosJobData,
  type AnalyzePhotosJobResult,
} from './preference-analyzer.constants';

/**
 * 취향 사진 분석 Worker.
 *
 * concurrency 를 올리지 않는 이유: vision 추론이 로컬 llama.cpp 단일 인스턴스로 가므로
 * 잡을 동시에 돌려도 서버 안에서 다시 직렬화되고, 26B 모델이라 컨텍스트 경합만 커진다.
 */
@Processor(PREFERENCE_ANALYSIS_QUEUE, { concurrency: 1 })
export class PreferenceAnalyzerProcessor extends WorkerHost {
  private readonly logger = new Logger(PreferenceAnalyzerProcessor.name);

  constructor(private readonly analysisService: PreferenceAnalysisService) {
    super();
  }

  async process(
    job: Job<AnalyzePhotosJobData, AnalyzePhotosJobResult>,
  ): Promise<AnalyzePhotosJobResult> {
    if (job.name !== ANALYZE_PHOTOS_JOB) return { analyzed: 0, photoKeys: [] };

    const started = Date.now();
    const result = await this.analysisService.runJob(job);
    this.logger.log(
      `취향 분석 잡 ${job.id} 완료 — 사진 ${result.analyzed}장, ${Date.now() - started}ms`,
    );
    return result;
  }
}
