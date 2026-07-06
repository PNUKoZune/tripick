import { Module } from '@nestjs/common';
import { TextEmbeddingService } from './text-embedding.service';

/**
 * 텍스트 → 벡터 임베딩 공용 모듈.
 * planner(place 검색)와 preferences(취향 벡터)가 동일한 임베딩 공간을 공유하도록
 * TextEmbeddingService 를 단일 provider 로 노출한다.
 */
@Module({
  providers: [TextEmbeddingService],
  exports: [TextEmbeddingService],
})
export class EmbeddingModule {}
