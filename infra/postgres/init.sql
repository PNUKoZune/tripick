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
  destination_region  TEXT,           -- 시도 라벨 (예: 서울, 경상북도). 소스 표기 그대로
  region_sigungu      TEXT,           -- 시군구 라벨 (예: 경주시, 해운대구). 소스 표기 그대로
  region_code         TEXT,           -- 시도 정본 코드 (예: 경북). 검색 pre-filter 등가 비교용
  sigungu_code        TEXT,           -- 시군구 정본 코드 (예: 경주). 접미사 제거
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
ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS region_code     TEXT;
ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS sigungu_code    TEXT;

-- 행사 기간 (KTO 축제공연행사). NULL 은 '기간 없음 = 상시'로 읽는다.
-- 축제는 장소가 아니라 기간이 있는 이벤트라, 소비 시점(여행 날짜)에 판정해야 한다.
ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS event_start_date date;
ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS event_end_date   date;

-- 앵커 반경(bbox) 검색용 위경도. coordinates jsonb 가 정본이고 이건 항상 그 파생이라
-- 손으로 동기화할 여지가 없다. jsonb 표현식은 인덱스를 못 타 전체 스캔이 된다.
ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS lat double precision
  GENERATED ALWAYS AS ((coordinates->>'lat')::double precision) STORED;
ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS lng double precision
  GENERATED ALWAYS AS ((coordinates->>'lng')::double precision) STORED;

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

-- 검색 pre-filter 용 정본 코드 인덱스.
-- ILIKE 라벨 매칭은 인덱스를 못 타 대규모에서 HNSW post-filter 로 밀려나므로,
-- 등가 비교로 먼저 좁힐 수 있게 코드 컬럼에 btree 를 둔다.
CREATE INDEX IF NOT EXISTS idx_place_embeddings_region_code
  ON place_embeddings (region_code);

CREATE INDEX IF NOT EXISTS idx_place_embeddings_sigungu_code
  ON place_embeddings (sigungu_code);

-- 앵커 반경 bbox 인덱스. 실측(10,333행, 광안리 3km) 26.8ms 전체 스캔 → 0.8ms.
CREATE INDEX IF NOT EXISTS idx_place_embeddings_lat_lng
  ON place_embeddings (lat, lng);

-- 로컬 seed 및 외부 API 후보 중복 방지/조회 최적화용 보조 인덱스
CREATE INDEX IF NOT EXISTS idx_place_embeddings_region_name
  ON place_embeddings (destination_region, name);

CREATE INDEX IF NOT EXISTS idx_place_embeddings_kakao_place_id
  ON place_embeddings (kakao_place_id);

-- 소스 간 중복 판정용 정규화 이름 인덱스 (findSamePlace).
-- 적재가 신규 후보마다 되묻는 조회라 없으면 매 건이 전체 스캔이고 카탈로그 크기에 선형으로 악화된다.
-- 인덱스 식은 질의 식과 문자까지 같아야 계획기가 쓴다.
CREATE INDEX IF NOT EXISTS idx_place_embeddings_normalized_name
  ON place_embeddings ((replace(lower(name), ' ', '')));

-- 적재 커서 (append 모드: 반복 실행 시 지역·소스별로 다음 지점부터 이어 적재)
-- 단위는 페이지가 아니라 행 오프셋이다 — 페이지 번호는 그 실행의 배치 크기(--max)에 묶여
-- 있어서, 쓴 실행과 읽는 실행의 --max 가 다르면 같은 숫자가 다른 구간을 뜻한다.
CREATE TABLE IF NOT EXISTS ingest_cursors (
  region      TEXT NOT NULL,      -- 시도 라벨 (예: 경상북도)
  source      TEXT NOT NULL,      -- 'tour' 등 소스
  next_offset INTEGER NOT NULL DEFAULT 0,  -- 다음 실행이 읽을 행 오프셋. 끝에 도달하면 0으로 wrap
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (region, source)
);

-- 기존 볼륨(page 커서)을 오프셋으로 환산해 컬럼을 교체한다 (재실행 안전).
-- 옛 기본 배치 100 을 가정한 근사이며, 내림 환산이라 이미 읽은 구간을 다시 확인할 뿐 건너뛰지 않는다.
ALTER TABLE ingest_cursors ADD COLUMN IF NOT EXISTS next_offset INTEGER NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ingest_cursors' AND column_name = 'next_page'
  ) THEN
    UPDATE ingest_cursors SET next_offset = GREATEST(0, (next_page - 1) * 100)
    WHERE next_offset = 0;
    ALTER TABLE ingest_cursors DROP COLUMN next_page;
  END IF;
END $$;
