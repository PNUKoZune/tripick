import { FileValidator } from '@nestjs/common';

/**
 * `@nestjs/common` 의 `IFile` 과 같은 형태. 그 타입은 패키지 루트에서 export 되지 않아
 * 딥 임포트가 필요한데, 구조가 같으면 제약을 그대로 만족하므로 여기 정의해 쓴다.
 */
interface UploadedFileLike {
  mimetype: string;
  size: number;
  buffer?: Buffer;
}

/**
 * 업로드 이미지 검증의 단일 출처.
 *
 * 예전엔 두 업로드 경로가 서로 다른 규칙을 썼다 — 프로필은 정확 일치 Set,
 * 취향 사진은 `@nestjs/common` 의 `FileTypeValidator` 에 **앵커 없는** 정규식
 * `/image\/(jpeg|png|webp)/` 이라 `ximage/png` 처럼 부분 일치하는 값도 통과했다.
 * 통과한 mimetype 은 그대로 오브젝트의 Content-Type 으로 저장되고, 그 오브젝트는
 * 웹과 **같은 오리진**(`/storage` 프록시)에서 되돌아온다.
 *
 * 그리고 두 경로 다 선언된 mimetype 만 믿었다. mimetype 은 클라이언트가 정하는
 * 값이라, 실제 바이트가 이미지인지는 아무도 확인하지 않았다. 여기서 매직바이트까지 본다.
 */
export const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

/**
 * 파일 앞머리가 실제 그 포맷인지. 선언된 mimetype 과 **짝이 맞아야** 통과한다 —
 * "이미지이긴 하다"만 보면 png 라고 선언한 jpeg 가 `.png` 키로 저장돼 Content-Type 이
 * 어긋난다.
 */
export function hasMatchingImageSignature(buffer: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') {
    // SOI 마커 FF D8 FF
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mime === 'image/png') {
    // \x89PNG\r\n\x1a\n
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
  }
  if (mime === 'image/webp') {
    // RIFF....WEBP — 길이 4바이트를 건너뛰고 8~12 를 본다
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 검증 실패 사유. null 이면 통과. */
export function imageUploadRejection(
  file: { mimetype: string; buffer?: Buffer; size?: number },
  maxBytes = MAX_IMAGE_BYTES,
): string | null {
  if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
    return 'JPG, PNG, WebP 이미지만 업로드할 수 있어요.';
  }
  const size = file.size ?? file.buffer?.length ?? 0;
  if (size > maxBytes) {
    return `이미지 크기는 ${Math.floor(maxBytes / (1024 * 1024))}MB 이하만 업로드할 수 있어요.`;
  }
  // 버퍼가 없으면(디스크 저장 모드) 매직바이트를 볼 수 없다 — 지금 두 업로드 경로는 모두
  // 메모리 저장이라 항상 있지만, 없을 때 "통과"로 넘기면 검사가 조용히 사라진다.
  if (!file.buffer) {
    return '이미지 파일을 읽지 못했어요.';
  }
  if (!hasMatchingImageSignature(file.buffer, file.mimetype)) {
    return '이미지 파일이 손상됐거나 형식이 확장자와 맞지 않아요.';
  }
  return null;
}

/**
 * `ParseFilePipe` 에 넣는 검증기. 다건 업로드(FilesInterceptor)에서도 파일마다 불리므로,
 * 서비스 경로(`UsersService.uploadProfileImage`)와 같은 규칙이 걸린다.
 */
export class ImageFileValidator extends FileValidator<{ maxBytes: number }, UploadedFileLike> {
  constructor(maxBytes = MAX_IMAGE_BYTES) {
    super({ maxBytes });
  }

  isValid(file?: UploadedFileLike | UploadedFileLike[] | Record<string, UploadedFileLike[]>): boolean {
    return this.firstRejection(file) === null;
  }

  buildErrorMessage(file: unknown): string {
    return this.firstRejection(file as UploadedFileLike | UploadedFileLike[] | undefined) ?? '';
  }

  /** 여러 건이 한 번에 오면 처음 걸린 사유를 쓴다 — 어떤 파일이든 하나라도 걸리면 거절. */
  private firstRejection(
    file?: UploadedFileLike | UploadedFileLike[] | Record<string, UploadedFileLike[]>,
  ): string | null {
    if (!file) return '이미지 파일이 필요해요.';
    const files: UploadedFileLike[] = Array.isArray(file)
      ? file
      : isFileRecord(file)
        ? Object.values(file).flat()
        : [file];
    if (files.length === 0) return '이미지 파일이 필요해요.';
    for (const entry of files) {
      const rejection = imageUploadRejection(entry, this.validationOptions.maxBytes);
      if (rejection) return rejection;
    }
    return null;
  }
}

function isFileRecord(
  value: UploadedFileLike | Record<string, UploadedFileLike[]>,
): value is Record<string, UploadedFileLike[]> {
  return typeof (value as UploadedFileLike).mimetype !== 'string';
}
