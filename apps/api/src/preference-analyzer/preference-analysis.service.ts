import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import { withTimeout } from '../common/with-timeout';
import type {
  PreferenceAnalysisJobDto,
  PreferenceAnalysisStatus,
  TasteTagDto,
} from '@tripick/types';
import { VisionAnalyzer } from './vision.analyzer';
import { PreferencesService } from '../preferences/preferences.service';
import { effectivePhotoTags, pruneToPhotos } from '../preferences/photo-taste';
import { StorageService } from '../storage/storage.service';
import { InboxService } from '../inbox/inbox.service';
import {
  ANALYZE_PHOTOS_JOB,
  ENQUEUE_TIMEOUT_MS,
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
    private readonly inbox: InboxService,
  ) {}

  /**
   * 업로드된 사진을 분석 큐에 올린다. 응답은 즉시 돌아가고 결과는 완료 시 푸시된다.
   *
   * attempts·backoff 는 AppModule 의 defaultJobOptions 를 그대로 쓴다(재시도 정책 일원화).
   */
  async enqueue(data: AnalyzePhotosJobData, allPhotoUrls: string[]): Promise<PreferenceAnalysisJobDto> {
    // Redis 가 죽어 있으면 queue.add 는 던지지도 끝나지도 않아 업로드 요청이 그대로 매달린다.
    const job = await withTimeout(
      this.queue.add(ANALYZE_PHOTOS_JOB, data, {
        // 상태 조회가 잠깐이라도 가능하도록 완료 후 바로 지우지 않는다.
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400 },
      }),
      ENQUEUE_TIMEOUT_MS,
      '분석 잡 등록 응답 없음',
    ).catch((err: unknown) => {
      this.logger.error(
        `분석 잡 등록 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
      // 사진 자체는 이미 보관됐다 — 분석만 시작되지 않았음을 분명히 알린다.
      throw new ServiceUnavailableException(
        '지금은 분석을 시작할 수 없습니다. 사진은 저장됐으니 잠시 후 다시 시도해주세요.',
      );
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
    const progress = typeof job.progress === 'number' ? job.progress : 0;
    // 진행 중에는 DB 를 보지 않는다 — 3초마다 폴링하므로 잡당 수십 번의 불필요한 조회가 된다.
    const preference = state === 'completed' ? await this.preferencesService.findByUser(userId) : null;

    return {
      jobId: String(job.id),
      status: this.toStatus(state),
      analyzed: progress,
      total: job.data.photoUrls.length,
      photoUrls: preference?.photoUrls ?? [],
      ...(preference ? { tasteTags: preference.tasteTags } : {}),
      ...(state === 'failed' ? { error: job.failedReason ?? '분석에 실패했습니다.' } : {}),
    };
  }

  /**
   * 실제 분석 본체 (Worker 에서 호출).
   * 새로 올라온 사진만 분석하고, 이미 분석해 둔 사진 결과와 합쳐 최종 취향 태그를 다시 만든다.
   */
  async runJob(job: Job<AnalyzePhotosJobData, AnalyzePhotosJobResult>): Promise<AnalyzePhotosJobResult> {
    const { userId, photoUrls, storageKeys } = job.data;

    // 재시도로 다시 들어온 경우 이미 분석해 둔 사진은 건너뛴다 — 장당 35초라 전량 재분석은 비싸다.
    const before = await this.preferencesService.findByUser(userId);
    const done = before?.photoTags ?? {};
    const pending = photoUrls
      .map((url, index) => ({ url, key: storageKeys[index] }))
      .filter((item): item is { url: string; key: string } => Boolean(item.url && item.key))
      .filter((item) => !done[item.url]);

    let progress = photoUrls.length - pending.length;
    await job.updateProgress(progress);

    const analyzed: Record<string, TasteTagDto> = {};
    const failed: string[] = [];

    for (const { url, key } of pending) {
      const { body, contentType } = await this.storage.getObject(key);
      const dataUrl = `data:${contentType};base64,${body.toString('base64')}`;
      const result = await this.visionAnalyzer.analyzePhoto(dataUrl);

      // 실패는 기록하지 않는다 — 빈 태그로 저장하면 '분석 완료, 취향 없음'과 구분이 안 되고
      // 이후 잡이 이 사진을 건너뛰어 영영 무신호로 남는다.
      if (result.ok) {
        analyzed[url] = result.tags;
        progress += 1;
        await job.updateProgress(progress);
      } else {
        failed.push(url);
      }
    }

    // 성공분은 실패가 섞여 있어도 먼저 반영한다 — 재시도가 남은 사진만 다시 하도록.
    const livePhotoUrls = await this.persistAnalyzed(userId, analyzed, photoUrls);

    if (failed.length > 0) {
      // 마지막 시도까지 실패하면 사용자에게 알리고, 던져서 BullMQ 재시도를 트리거한다.
      if (this.isFinalAttempt(job)) await this.notifyFailed(userId, failed.length);
      throw new Error(`사진 ${failed.length}장 분석 실패 (vision 서버 응답 없음)`);
    }

    // 알림 실패로 잡을 실패시키지 않는다 — 분석 결과는 이미 저장됐고, 실패하면 재분석만 도돌이된다.
    try {
      await this.notifyDone(userId, await this.currentTasteTags(userId));
    } catch (err) {
      this.logger.warn(
        `취향 분석 완료 알림 실패 (user=${userId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { analyzed: Object.keys(analyzed).length, photoUrls: livePhotoUrls };
  }

  /** 분석 결과를 기존 결과와 합쳐 저장하고, 살아있는 사진 목록을 돌려준다. */
  private async persistAnalyzed(
    userId: string,
    analyzed: Record<string, TasteTagDto>,
    jobPhotoUrls: string[],
  ): Promise<string[]> {
    const preference = await this.preferencesService.findByUser(userId);
    // 저장된 사진 목록에 없는 결과는 버린다 (분석 중에 삭제된 사진).
    const livePhotoUrls = preference?.photoUrls ?? jobPhotoUrls;
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
    return livePhotoUrls;
  }

  private async currentTasteTags(userId: string): Promise<TasteTagDto> {
    const preference = await this.preferencesService.findByUser(userId);
    return preference?.tasteTags ?? { food: [], mood: [], environment: [], confidence: 0 };
  }

  private isFinalAttempt(job: Job<AnalyzePhotosJobData, AnalyzePhotosJobResult>): boolean {
    const maxAttempts = job.opts.attempts ?? 1;
    return job.attemptsMade + 1 >= maxAttempts;
  }

  private async notifyFailed(userId: string, count: number): Promise<void> {
    // create 가 인박스 row 저장 + 수신 토글 확인 + FCM + WS 실시간 갱신까지 담당한다.
    // sendToUser 직접 호출은 FCM 전용이라 인박스에 안 남고 Firebase 미설정이면 무음이었다.
    await this.inbox.create({
      userId,
      // 전용 알림 키를 새로 파면 사용자 알림 설정·기본값까지 건드려야 해서 general 로 보낸다.
      category: 'general',
      title: '취향 분석 실패',
      body: `사진 ${count}장을 분석하지 못했어요. 잠시 후 다시 올려주세요.`,
      payload: { route: '/preferences' },
    });
  }

  private async notifyDone(userId: string, tasteTags: TasteTagDto): Promise<void> {
    const count = tasteTags.food.length + tasteTags.mood.length + tasteTags.environment.length;
    // 알림은 부수효과 — 실패해도 분석 결과는 이미 저장됐으므로 잡을 실패시키지 않는다.
    await this.inbox.create({
      userId,
      category: 'general',
      title: '취향 분석 완료',
      body:
        count > 0
          ? '사진에서 취향을 찾았어요. 확인해보세요.'
          : '뚜렷한 취향을 찾지 못했어요. 다른 사진을 올려보세요.',
      payload: { route: '/preferences' },
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
