/** 프로필 아바타(최대 112px 렌더) 업로드용 — 표시 전용이라 작게, webp 로 압축. */
export const AVATAR_MAX_DIMENSION = 256;
/** 취향 사진 업로드용 — vision 분석이 해상도를 쓰므로 표시(80px)보다 크게 유지. */
export const PREFERENCE_MAX_DIMENSION = 1024;

type OutputFormat = 'image/webp' | 'image/jpeg';

type DownscaleOptions = {
  /** 긴 변 최대 픽셀. 이보다 크면 비율 유지하며 축소. */
  maxDimension: number;
  /**
   * 출력 포맷. 기본 webp(표시용, 압축 우수).
   * 로컬 vision 서버(llama.cpp mtmd = stb_image)는 webp 를 못 읽으므로,
   * 분석에 태울 취향 사진은 반드시 'image/jpeg' 로 내보내야 한다.
   */
  format?: OutputFormat;
  /** 인코딩 품질 (0~1). 기본 0.85 */
  quality?: number;
};

const EXT_FOR_FORMAT: Record<OutputFormat, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
};

/**
 * 업로드 전 이미지를 브라우저 canvas 에서 다운스케일한다.
 * 서버는 원본 buffer 를 그대로 저장하므로, 축소는 여기서 끝내야 다운로드·vision 추론 용량이 준다.
 *
 * 안전 폴백 — 캔버스 미지원, 디코드·인코드 실패, 결과가 원본보다 큰 경우엔 원본 File 을 그대로 돌려준다.
 * 서버가 jpeg/png/webp 를 모두 받으므로 폴백해도 업로드는 성공한다.
 * EXIF 회전은 createImageBitmap 의 imageOrientation 으로 보정한다.
 */
export async function downscaleImage(
  file: File,
  { maxDimension, format = 'image/webp', quality = 0.85 }: DownscaleOptions,
): Promise<File> {
  if (typeof document === 'undefined') return file;
  if (!file.type.startsWith('image/')) return file;

  try {
    const bitmap = await decode(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, maxDimension / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    // jpeg 는 투명도가 없어 알파가 검게 나오므로 흰 배경을 먼저 깐다.
    if (format === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, format, quality),
    );
    // 요청 포맷으로 안 나오면(브라우저 미지원) 원본 유지 — 잘못된 포맷을 서버로 보내지 않는다.
    if (!blob || blob.type !== format) return file;
    // 같은 포맷 재인코딩이 오히려 커지면 원본 유지. 단 포맷을 바꾸는 변환(webp→jpeg 등)은
    // 크기와 무관하게 통과시킨다 — vision 서버가 원본 webp 를 못 읽어서다.
    if (blob.size >= file.size && blob.type === file.type) return file;

    return new File([blob], renameExt(file.name, EXT_FOR_FORMAT[format]), {
      type: format,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // 일부 브라우저는 옵션 인자 자체를 던진다 — 옵션 없이 재시도.
    return createImageBitmap(file);
  }
}

function renameExt(name: string, ext: string): string {
  return `${name.replace(/\.[^./\\]+$/, '')}.${ext}`;
}
