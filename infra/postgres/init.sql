-- 로컬 docker-compose 최초 기동 전용 (postgres 컨테이너 entrypoint).
-- 같은 내용이 TypeORM 마이그레이션에도 있다:
--   apps/api/src/database/migrations/1700000000000-InitVectorSchema.ts
-- 프로덕션은 그 마이그레이션이 적용하므로, 이 파일을 고치면 마이그레이션도 같이 고쳐야 한다.
-- (기존 마이그레이션 수정 대신 새 마이그레이션 추가가 원칙 — 이미 적용된 DB 가 있으므로)

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
  image_url           TEXT,           -- 대표 이미지 (KTO firstimage 등)
  opening_hours       TEXT,           -- 'HH:MM-HH:MM' (KTO detailIntro2). 제약 검증·CRAG 가용성 점수용
  embedding           vector(1024),  -- BGE-m3(-ko) 차원. preference_embeddings 와 반드시 동일
  text_hash           TEXT,           -- 임베딩 대상 텍스트 해시. 동일하면 재임베딩 생략(증분 upsert)
  embedding_model     TEXT,           -- 임베딩에 사용한 모델. 모델 전환 감지 → 재임베딩 트리거
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 기존 볼륨에 이미 테이블이 있는 경우를 위한 증분 컬럼 추가 (재실행 안전)
ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS region_sigungu  TEXT;
ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS image_url       TEXT;
ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS opening_hours   TEXT;
ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS text_hash       TEXT;
ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT NOW();

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

-- 적재 페이지 커서 (append 모드: 반복 실행 시 지역·소스별로 다음 페이지부터 이어 적재)
CREATE TABLE IF NOT EXISTS ingest_cursors (
  region     TEXT NOT NULL,      -- 시도 라벨 (예: 경상북도)
  source     TEXT NOT NULL,      -- 'tour' 등 소스
  next_page  INTEGER NOT NULL DEFAULT 1,  -- 다음 실행이 읽을 페이지. 끝에 도달하면 1로 wrap
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (region, source)
);
