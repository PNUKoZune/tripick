-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 취향 임베딩 테이블 (pgvector) : 유저당 1행, RAG 검색 개인화 벡터
CREATE TABLE IF NOT EXISTS preference_embeddings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID,
  embedding   vector(1024),  -- BGE-m3(-ko) 차원. 모델 교체 시 LLM_EMBEDDING_DIMENSIONS 와 함께 변경
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
  destination_region  TEXT,           -- 시도 라벨 (예: 서울, 경상북도)
  region_sigungu      TEXT,           -- 시군구 라벨 (예: 경주시, 해운대구). 시/군 단위 정밀 필터용
  coordinates         JSONB,
  embedding           vector(1024),  -- BGE-m3(-ko) 차원. preference_embeddings 와 반드시 동일
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 기존 볼륨에 이미 테이블이 있는 경우를 위한 증분 컬럼 추가 (재실행 안전)
ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS region_sigungu TEXT;

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

-- 시군구 정밀 필터 인덱스
CREATE INDEX IF NOT EXISTS idx_place_embeddings_sigungu
  ON place_embeddings (region_sigungu);

-- 로컬 seed 및 외부 API 후보 중복 방지/조회 최적화용 보조 인덱스
CREATE INDEX IF NOT EXISTS idx_place_embeddings_region_name
  ON place_embeddings (destination_region, name);

CREATE INDEX IF NOT EXISTS idx_place_embeddings_kakao_place_id
  ON place_embeddings (kakao_place_id);
