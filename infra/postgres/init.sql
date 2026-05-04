-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 취향 임베딩 테이블 (pgvector)
CREATE TABLE IF NOT EXISTS preference_embeddings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  embedding   vector(1536),  -- OpenAI text-embedding-3-small 차원 (조정 가능)
  tags_text   TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 장소 임베딩 테이블 (pgvector)
CREATE TABLE IF NOT EXISTS place_embeddings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kakao_place_id      TEXT,
  tourism_api_id      TEXT,
  name                TEXT NOT NULL,
  address             TEXT,
  category            TEXT,
  destination_region  TEXT,
  coordinates         JSONB,
  embedding           vector(1536),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- pgvector HNSW 인덱스 (코사인 유사도 검색)
CREATE INDEX IF NOT EXISTS idx_preference_embeddings_hnsw
  ON preference_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_place_embeddings_hnsw
  ON place_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 장소 임베딩 destination_region 인덱스
CREATE INDEX IF NOT EXISTS idx_place_embeddings_region
  ON place_embeddings (destination_region);
