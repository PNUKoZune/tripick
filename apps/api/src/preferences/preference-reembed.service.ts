import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { PreferenceProfileDto, TasteTagDto } from '@tripick/types';
import { PreferenceEmbeddingRepository } from './preference-embedding.repository';
import { buildPreferenceText } from './preference-text';
import { TextEmbeddingService } from '../embedding/text-embedding.service';

interface PreferenceRow {
  userId: string;
  tasteTags: TasteTagDto | null;
  profile: PreferenceProfileDto | null;
}

export interface ReembedSummary {
  total: number;
  updated: number;
  skipped: number;
  failed: number;
}

/**
 * 저장된 모든 사용자 취향을 현재 임베딩 소스로 다시 임베딩해 preference_embeddings 를 갱신한다.
 * place 의 `ingest:places --reseed` 와 짝이 되는 취향 측 재시드 도구.
 * 임베딩 모델 서버를 전환했을 때 취향 벡터를 place 벡터와 같은 공간으로 재생성하기 위해 사용.
 */
@Injectable()
export class PreferenceReembedService {
  private readonly logger = new Logger(PreferenceReembedService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly embeddings: TextEmbeddingService,
    private readonly preferenceEmbeddings: PreferenceEmbeddingRepository,
  ) {}

  async reembedAll(options: { allowHash?: boolean } = {}): Promise<ReembedSummary> {
    const allowHash = options.allowHash ?? false;
    // 안전장치: 재임베딩 전 임베딩 서버가 실제 벡터를 주는지 확인. 해시 폴백이면 중단.
    await this.assertEmbeddingServerReady(allowHash);

    const rows: PreferenceRow[] = await this.dataSource.query(
      'SELECT "userId", "tasteTags", profile FROM preferences',
    );
    this.logger.log(`재임베딩 대상 취향 ${rows.length}건`);

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of rows) {
      const text = buildPreferenceText(row.tasteTags ?? undefined, row.profile ?? undefined);
      if (!text.trim()) {
        // 취향 신호가 없는 유저는 제네릭 벡터를 만들지 않고 건너뛴다.
        skipped += 1;
        continue;
      }
      const vector = await this.embedStrict(text, allowHash);
      const embeddingId = await this.preferenceEmbeddings.upsertUserEmbedding(
        row.userId,
        vector,
        text,
      );
      if (!embeddingId) {
        failed += 1;
        continue;
      }
      await this.dataSource.query('UPDATE preferences SET "embeddingId" = $1 WHERE "userId" = $2', [
        embeddingId,
        row.userId,
      ]);
      updated += 1;
    }

    this.logger.log(`재임베딩 완료: ${updated}건 갱신, ${skipped}건 건너뜀, ${failed}건 실패`);
    return { total: rows.length, updated, skipped, failed };
  }

  /** 재임베딩 시작 전 임베딩 서버가 실제 벡터를 주는지 확인한다. 해시 폴백이면 중단. */
  private async assertEmbeddingServerReady(allowHash: boolean): Promise<void> {
    const probe = await this.embeddings.embedWithSource('임베딩 서버 헬스체크');
    if (probe.source === 'remote') {
      const expected = this.embeddings.dimensions();
      if (probe.remoteDimensions !== expected) {
        // 차원 불일치는 normalizeDimensions 가 조용히 패딩/절단해 공간을 오염시킨다. 항상 중단.
        throw new Error(
          `임베딩 서버가 ${probe.remoteDimensions}차원을 반환했지만 기대 차원은 ${expected}입니다. ` +
            '엉뚱한 모델이 올라갔을 가능성이 큽니다. ' +
            'LLM_EMBEDDING_MODEL 이 차원과 맞는지, LLM_EMBEDDING_DIMENSIONS·init.sql 의 vector(N) 이 일치하는지 확인하세요.',
        );
      }
      return;
    }
    if (allowHash) {
      this.logger.warn('임베딩 서버 미가용 — 해시 폴백으로 재임베딩을 강행합니다(--allow-hash).');
      return;
    }
    throw new Error(
      '임베딩 서버에 연결할 수 없어(해시 폴백 감지) 취향 재임베딩을 중단합니다. ' +
        'LLM_EMBEDDING_BASE_URL / LLM_EMBEDDING_MODEL 을 확인하거나, 의도한 것이면 --allow-hash 로 재실행하세요.',
    );
  }

  /** 해시 폴백이 감지되면(allowHash=false) 1회 재시도 후 중단한다. */
  private async embedStrict(text: string, allowHash: boolean): Promise<number[]> {
    const first = await this.embeddings.embedWithSource(text);
    if (first.source === 'remote' || allowHash) return first.vector;
    const retry = await this.embeddings.embedWithSource(text);
    if (retry.source === 'remote') return retry.vector;
    throw new Error(
      '재임베딩 중 임베딩 서버 응답 실패(해시 폴백)로 중단합니다. 서버 복구 후 재실행하세요.',
    );
  }
}
