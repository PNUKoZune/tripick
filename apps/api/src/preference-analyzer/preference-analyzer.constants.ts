export const PREFERENCE_ANALYSIS_QUEUE = 'preference-analysis';
export const ANALYZE_PHOTOS_JOB = 'analyze-photos';

/**
 * 잡 등록 응답 대기 상한(ms).
 * Redis 무응답 시 queue.add 는 던지지 않고 오프라인 큐에 버퍼링되어 영영 안 끝나므로,
 * 업로드 요청이 통째로 매달리지 않게 상한을 둔다.
 */
export const ENQUEUE_TIMEOUT_MS = 10_000;

/**
 * 잡 페이로드 — 이미지 바이트는 Redis 에 싣지 않고 스토리지 키만 넘긴다.
 *
 * 예전엔 `photoUrls`(식별자 겸 표시용)와 `storageKeys`(원본 읽기용)를 나란히 실었는데,
 * 사진이 비공개 버킷으로 옮겨져 식별자 자체가 키가 되면서 두 배열이 같아졌다 — 하나로 합쳤다.
 */
export interface AnalyzePhotosJobData {
  userId: string;
  /** 이번 잡이 분석할 사진의 비공개 버킷 키 */
  photoKeys: string[];
}

export interface AnalyzePhotosJobResult {
  analyzed: number;
  photoKeys: string[];
}
