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

  async reembedAll(): Promise<ReembedSummary> {
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
      const vector = await this.embeddings.embed(text);
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
}
