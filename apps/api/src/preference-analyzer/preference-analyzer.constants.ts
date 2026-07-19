export const PREFERENCE_ANALYSIS_QUEUE = 'preference-analysis';
export const ANALYZE_PHOTOS_JOB = 'analyze-photos';

/**
 * 잡 등록 응답 대기 상한(ms).
 * Redis 무응답 시 queue.add 는 던지지 않고 오프라인 큐에 버퍼링되어 영영 안 끝나므로,
 * 업로드 요청이 통째로 매달리지 않게 상한을 둔다.
 */
export const ENQUEUE_TIMEOUT_MS = 10_000;

/** 잡 페이로드 — 이미지 바이트는 Redis 에 싣지 않고 스토리지 키만 넘긴다. */
export interface AnalyzePhotosJobData {
  userId: string;
  /** 이번에 업로드돼 분석 대상이 되는 사진 (공개 URL) */
  photoUrls: string[];
  /** 스토리지에서 원본을 다시 읽기 위한 키. photoUrls 와 같은 순서. */
  storageKeys: string[];
}

export interface AnalyzePhotosJobResult {
  analyzed: number;
  photoUrls: string[];
}
