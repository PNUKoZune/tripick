import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import type {
  PreferenceAnalysisJobDto,
  PreferenceAnalysisStatus,
  TasteTagDto,
} from '@tripick/types';
import { VisionAnalyzer } from './vision.analyzer';
import { PreferencesService } from '../preferences/preferences.service';
import { effectivePhotoTags, pruneToPhotos } from '../preferences/photo-taste';
import { StorageService } from '../storage/storage.service';
import { NotificationService } from '../notification/notification.service';
import {
  ANALYZE_PHOTOS_JOB,
  PREFERENCE_ANALYSIS_QUEUE,
  type AnalyzePhotosJobData,
  type AnalyzePhotosJobResult,
} from './preference-analyzer.constants';

@Injectable()
export class PreferenceAnalysisService {
  private readonly logger = new Logger(PreferenceAnalysisService.name);

  constructor(
    @InjectQueue(PREFERENCE_ANALYSIS_QUEUE)
    private readonly queue: Queue<AnalyzePhotosJobData, AnalyzePhotosJobResult>,
    private readonly visionAnalyzer: VisionAnalyzer,
    private readonly preferencesService: PreferencesService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
  ) {}

  /** 업로드된 사진을 분석 큐에 올린다. 응답은 즉시 돌아가고 결과는 완료 시 푸시된다. */
  async enqueue(data: AnalyzePhotosJobData, allPhotoUrls: string[]): Promise<PreferenceAnalysisJobDto> {
    const job = await this.queue.add(ANALYZE_PHOTOS_JOB, data, {
      attempts: 3,
      backoff: { type: 'fixed', delay: 2000 },
      // 상태 조회가 잠깐이라도 가능하도록 완료 후 바로 지우지 않는다.
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 86400 },
    });

    return {
      jobId: String(job.id),
      status: 'queued',
      analyzed: 0,
      total: data.photoUrls.length,
      photoUrls: allPhotoUrls,
    };
  }

  /**
   * 잡 진행 상황 조회.
   * 사용자가 페이지를 떠났다 돌아와도 상태를 복원할 수 있어야 해서 열어 둔다.
   * 잡이 만료돼 사라졌으면 unknown 을 돌려주고, 프론트는 저장된 취향을 그대로 보여주면 된다.
   */
  async getStatus(jobId: string, userId: string): Promise<PreferenceAnalysisJobDto | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    // 남의 잡 상태를 들여다볼 수 없도록 소유자를 확인한다.
    if (job.data.userId !== userId) return null;

    const state = await job.getState();
    const preference = await this.preferencesService.findByUser(userId);
    const progress = typeof job.progress === 'number' ? job.progress : 0;

    return {
      jobId: String(job.id),
      status: this.toStatus(state),
      analyzed: progress,
      total: job.data.photoUrls.length,
      photoUrls: preference?.photoUrls ?? [],
      ...(state === 'completed' && preference ? { tasteTags: preference.tasteTags } : {}),
      ...(state === 'failed' ? { error: job.failedReason ?? '분석에 실패했습니다.' } : {}),
    };
  }

  /**
   * 실제 분석 본체 (Worker 에서 호출).
   * 새로 올라온 사진만 분석하고, 이미 분석해 둔 사진 결과와 합쳐 최종 취향 태그를 다시 만든다.
   */
  async runJob(job: Job<AnalyzePhotosJobData, AnalyzePhotosJobResult>): Promise<AnalyzePhotosJobResult> {
    const { userId, photoUrls, storageKeys } = job.data;
    const analyzed: Record<string, TasteTagDto> = {};

    for (const [index, key] of storageKeys.entries()) {
      const url = photoUrls[index];
      if (!url) continue;

      const { body, contentType } = await this.storage.getObject(key);
      const dataUrl = `data:${contentType};base64,${body.toString('base64')}`;
      analyzed[url] = await this.visionAnalyzer.analyzeImage(dataUrl);

      await job.updateProgress(index + 1);
    }

    // 기존 사진 결과 + 이번 결과를 합쳐 전체를 다시 집계한다.
    const preference = await this.preferencesService.findByUser(userId);
    // 저장된 사진 목록에 없는 결과는 버린다 (분석 중에 삭제된 사진).
    const livePhotoUrls = preference?.photoUrls ?? photoUrls;
    const livePhotoTags = pruneToPhotos(
      { ...(preference?.photoTags ?? {}), ...analyzed },
      livePhotoUrls,
    );
    const disabledPhotoTags = pruneToPhotos(preference?.disabledPhotoTags ?? {}, livePhotoUrls);

    // 사용자가 꺼둔 태그는 집계에서 뺀다 — 새 사진을 올려도 기존 선택이 유지되어야 한다.
    const tasteTags = this.visionAnalyzer.aggregate(
      effectivePhotoTags({
        photoUrls: livePhotoUrls,
        photoTags: livePhotoTags,
        disabledPhotoTags,
      }),
    );
    await this.preferencesService.upsert(userId, {
      tasteTags,
      photoTags: livePhotoTags,
      disabledPhotoTags,
    });

    await this.notifyDone(userId, tasteTags);

    return { analyzed: Object.keys(analyzed).length, photoUrls: livePhotoUrls };
  }

  private async notifyDone(userId: string, tasteTags: TasteTagDto): Promise<void> {
    const count = tasteTags.food.length + tasteTags.mood.length + tasteTags.environment.length;
    // 푸시는 부수효과 — 실패해도 분석 결과는 이미 저장됐으므로 잡을 실패시키지 않는다.
    await this.notifications.sendToUser({
      userId,
      // 전용 알림 키를 새로 파면 사용자 알림 설정·기본값까지 건드려야 해서 general 로 보낸다.
      type: 'general',
      title: '취향 분석 완료',
      body:
        count > 0
          ? '사진에서 취향을 찾았어요. 확인해보세요.'
          : '뚜렷한 취향을 찾지 못했어요. 다른 사진을 올려보세요.',
      data: { type: 'preference-analysis', route: '/preferences' },
    });
  }

  private toStatus(state: string): PreferenceAnalysisStatus {
    if (state === 'completed') return 'completed';
    if (state === 'failed') return 'failed';
    if (state === 'active') return 'running';
    if (state === 'waiting' || state === 'delayed' || state === 'waiting-children') return 'queued';
    return 'unknown';
  }
}
