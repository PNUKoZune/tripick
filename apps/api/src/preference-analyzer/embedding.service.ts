import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import axios from 'axios';
import type { TasteTagDto } from '@tripick/types';

/**
 * pgvector 임베딩 저장 서비스
 *
 * Triton Inference Server (embedding 모델) 로 텍스트 → 벡터 변환 후
 * preference_embeddings 테이블에 저장.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async embedTasteTags(tasteTags: TasteTagDto): Promise<string> {
    const text = [
      ...tasteTags.food,
      ...tasteTags.mood,
      ...tasteTags.environment,
    ].join(', ');

    const vector = await this.getEmbeddingVector(text);

    const result: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO preference_embeddings (embedding, tags_text)
       VALUES ($1::vector, $2)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [`[${vector.join(',')}]`, text],
    );

    return result[0]?.id ?? '';
  }

  private async getEmbeddingVector(text: string): Promise<number[]> {
    const baseUrl = this.config.get<string>('LLM_BASE_URL', 'http://localhost:8080/v1');
    const apiKey = this.config.get<string>('LLM_API_KEY', 'local');

    try {
      const res = await axios.post<{ data: Array<{ embedding: number[] }> }>(
        `${baseUrl}/embeddings`,
        { input: text, model: 'text-embedding-model' },
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      return res.data.data[0]?.embedding ?? [];
    } catch (err) {
      this.logger.error('임베딩 생성 실패:', err);
      return [];
    }
  }
}
