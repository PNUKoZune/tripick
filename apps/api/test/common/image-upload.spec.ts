/// <reference types="jest" />

import {
  ImageFileValidator,
  hasMatchingImageSignature,
  imageUploadRejection,
} from '../../src/common/image-upload';

/** 각 포맷의 유효한 앞머리 + 뒤에 아무 바이트. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(20),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x20, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.alloc(20),
]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');

const file = (mimetype: string, buffer: Buffer) => ({
  mimetype,
  buffer,
  size: buffer.length,
});

describe('imageUploadRejection — mimetype 허용목록', () => {
  it('허용 포맷은 통과한다', () => {
    expect(imageUploadRejection(file('image/jpeg', JPEG))).toBeNull();
    expect(imageUploadRejection(file('image/png', PNG))).toBeNull();
    expect(imageUploadRejection(file('image/webp', WEBP))).toBeNull();
  });

  /**
   * 예전 `FileTypeValidator({ fileType: /image\/(jpeg|png|webp)/ })` 는 앵커가 없어
   * 부분 일치하는 값이 통과했고, 그 값이 그대로 오브젝트 Content-Type 이 됐다.
   */
  it('부분 일치하는 mimetype 을 거부한다 (앵커 없는 정규식이 통과시켰던 값)', () => {
    expect(imageUploadRejection(file('ximage/png', PNG))).not.toBeNull();
    expect(imageUploadRejection(file('image/pngx', PNG))).not.toBeNull();
    expect(imageUploadRejection(file('text/html,image/png', HTML))).not.toBeNull();
  });

  it('이미지가 아닌 mimetype 을 거부한다', () => {
    expect(imageUploadRejection(file('image/svg+xml', HTML))).not.toBeNull();
    expect(imageUploadRejection(file('text/html', HTML))).not.toBeNull();
  });
});

describe('imageUploadRejection — 실제 바이트', () => {
  // mimetype 은 클라이언트가 정하는 값이라, 선언만 믿으면 아무 바이트나 이미지로 저장된다.
  it('선언은 이미지지만 내용이 아니면 거부한다', () => {
    expect(imageUploadRejection(file('image/png', HTML))).not.toBeNull();
    expect(imageUploadRejection(file('image/jpeg', HTML))).not.toBeNull();
  });

  // png 라고 선언한 jpeg 를 통과시키면 `.png` 키에 Content-Type 이 어긋난 채로 저장된다.
  it('포맷이 선언과 짝이 안 맞으면 거부한다', () => {
    expect(imageUploadRejection(file('image/png', JPEG))).not.toBeNull();
    expect(imageUploadRejection(file('image/jpeg', PNG))).not.toBeNull();
  });

  it('버퍼가 없으면 통과가 아니라 거부다', () => {
    expect(imageUploadRejection({ mimetype: 'image/png', size: 10 })).not.toBeNull();
  });

  it('앞머리만 맞으면 뒤 내용은 보지 않는다', () => {
    expect(hasMatchingImageSignature(PNG, 'image/png')).toBe(true);
    expect(hasMatchingImageSignature(Buffer.from([0x89, 0x50]), 'image/png')).toBe(false);
  });
});

describe('imageUploadRejection — 크기', () => {
  it('상한을 넘으면 거부한다', () => {
    expect(imageUploadRejection(file('image/png', PNG), 10)).not.toBeNull();
  });

  it('상한 이하는 통과한다', () => {
    expect(imageUploadRejection(file('image/png', PNG), 1024)).toBeNull();
  });
});

describe('ImageFileValidator', () => {
  const validator = new ImageFileValidator();

  it('단건을 검증한다', () => {
    expect(validator.isValid(file('image/png', PNG))).toBe(true);
    expect(validator.isValid(file('image/png', HTML))).toBe(false);
  });

  // 다건 업로드에서 한 장만 위조해도 요청 전체가 떨어져야 한다.
  it('여러 건 중 하나라도 걸리면 거부한다', () => {
    expect(validator.isValid([file('image/png', PNG), file('image/jpeg', JPEG)])).toBe(true);
    expect(validator.isValid([file('image/png', PNG), file('image/png', HTML)])).toBe(false);
  });

  it('파일이 없으면 거부하고 사유를 준다', () => {
    expect(validator.isValid(undefined)).toBe(false);
    expect(validator.buildErrorMessage(undefined)).not.toBe('');
    expect(validator.isValid([])).toBe(false);
  });

  it('거부 사유를 에러 메시지로 준다', () => {
    expect(validator.buildErrorMessage(file('text/html', HTML))).toContain('JPG');
  });
});
