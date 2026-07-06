-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 취향 임베딩 테이블 (pgvector) : 유저당 1행, RAG 검색 개인화 벡터
CREATE TABLE IF NOT EXISTS preference_embeddings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID,
  embedding   vector(1536),  -- OpenAI text-embedding-3-small 차원 (조정 가능)
  tags_text   TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 기존 볼륨 호환용 (CREATE TABLE 이 이미 존재하는 경우 컬럼 보강)
ALTER TABLE preference_embeddings ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE preference_embeddings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 유저당 1개 취향 벡터만 유지 (upsert 대상)
CREATE UNIQUE INDEX IF NOT EXISTS idx_preference_embeddings_user
  ON preference_embeddings (user_id);

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

-- 로컬 seed 및 외부 API 후보 중복 방지/조회 최적화용 보조 인덱스
CREATE INDEX IF NOT EXISTS idx_place_embeddings_region_name
  ON place_embeddings (destination_region, name);

CREATE INDEX IF NOT EXISTS idx_place_embeddings_kakao_place_id
  ON place_embeddings (kakao_place_id);
