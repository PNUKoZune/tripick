/// <reference types="jest" />

import { StorageService } from '../../src/storage/storage.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((input) => ({ __type: 'put', input })),
  GetObjectCommand: jest.fn((input) => ({ __type: 'get', input })),
  DeleteObjectCommand: jest.fn((input) => ({ __type: 'delete', input })),
}));

/** presigner 는 서명 쿼리가 붙은 절대 URL 을 돌려준다 — 형태만 재현한다. */
const mockGetSignedUrl = jest.fn(
  async (_client: unknown, command: { input: { Bucket: string; Key: string } }) =>
    `http://localhost:9000/${command.input.Bucket}/${command.input.Key}` +
    `?X-Amz-Signature=abc&X-Amz-Expires=900`,
);
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...(args as [never, never])),
}));

function config(overrides: Record<string, string> = {}) {
  return {
    get: <T>(key: string, def?: T) => (key in overrides ? (overrides[key] as unknown as T) : def),
  } as any;
}

const FULL_ENV = {
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_ACCESS_KEY: 'minio',
  STORAGE_SECRET_KEY: 'minio123',
  STORAGE_BUCKET: 'tripick',
};

function ready(overrides: Record<string, string> = {}) {
  const svc = new StorageService(config({ ...FULL_ENV, ...overrides }));
  svc.onModuleInit();
  return svc;
}

describe('StorageService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('isReady', () => {
    it('is false when env is incomplete', () => {
      const svc = new StorageService(config());
      svc.onModuleInit();
      expect(svc.isReady()).toBe(false);
    });

    it('is true when env is complete', () => {
      expect(ready().isReady()).toBe(true);
    });
  });

  describe('putObject', () => {
    it('throws when storage is not configured', async () => {
      const svc = new StorageService(config());
      svc.onModuleInit();
      await expect(
        svc.putObject({ key: 'k', body: Buffer.from(''), contentType: 'image/png' }),
      ).rejects.toThrow('not configured');
    });

    it('sends a PutObjectCommand and returns the public URL', async () => {
      mockSend.mockResolvedValue({});
      const svc = ready();

      const url = await svc.putObject({
        key: 'public/profiles/u1/1.png',
        body: Buffer.from('img'),
        contentType: 'image/png',
      });

      expect(url).toBe('http://localhost:9000/tripick/public/profiles/u1/1.png');
      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.Bucket).toBe('tripick');
      expect(command.input.Key).toBe('public/profiles/u1/1.png');
    });
  });

  describe('deleteObject', () => {
    it('is a no-op when storage is not configured', async () => {
      const svc = new StorageService(config());
      svc.onModuleInit();
      await expect(svc.deleteObject('k')).resolves.toBeUndefined();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('swallows delete failures without throwing', async () => {
      mockSend.mockRejectedValue(new Error('gone'));
      const svc = ready();
      await expect(svc.deleteObject('public/a.png')).resolves.toBeUndefined();
    });
  });

  describe('URL helpers', () => {
    it('honours STORAGE_PUBLIC_URL over the endpoint/bucket default', () => {
      const svc = ready({ STORAGE_PUBLIC_URL: 'https://cdn.tripick.app' });
      expect(svc.publicUrl('public/a.png')).toBe('https://cdn.tripick.app/public/a.png');
    });

    it('extracts the key from one of our public URLs', () => {
      const svc = ready();
      expect(svc.keyFromPublicUrl('http://localhost:9000/tripick/public/a.png')).toBe(
        'public/a.png',
      );
    });

    it('returns null for external URLs', () => {
      const svc = ready();
      expect(svc.keyFromPublicUrl('https://k.kakaocdn.net/img/x.jpg')).toBeNull();
    });

    it('returns null when storage (and thus the URL base) is unconfigured', () => {
      const svc = new StorageService(config());
      svc.onModuleInit();
      expect(svc.keyFromPublicUrl('http://localhost:9000/tripick/public/a.png')).toBeNull();
    });
  });

  describe('비공개 버킷', () => {
    it('버킷이 설정돼야 준비 상태다', () => {
      expect(ready().isPrivateReady()).toBe(false);
      expect(ready({ STORAGE_PRIVATE_BUCKET: 'tripick-private' }).isPrivateReady()).toBe(true);
    });

    /**
     * 공개 버킷 폴백을 두면 개인 사진이 CDN 도메인에서 그대로 열린다 —
     * 이 구조로 막으려는 노출이 그대로 남으므로 조용히 성공하면 안 된다.
     */
    it('설정이 없으면 비공개 업로드가 실패한다 (공개 버킷 폴백 없음)', async () => {
      const svc = ready();
      await expect(
        svc.putPrivateObject({ key: 'preferences/u/a.jpg', body: Buffer.from('x'), contentType: 'image/jpeg' }),
      ).rejects.toThrow(/STORAGE_PRIVATE_BUCKET/);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('비공개 업로드는 비공개 버킷에 쓰고 키를 돌려준다', async () => {
      const svc = ready({ STORAGE_PRIVATE_BUCKET: 'tripick-private' });
      mockSend.mockResolvedValueOnce({});
      const key = await svc.putPrivateObject({
        key: 'preferences/u/a.jpg',
        body: Buffer.from('x'),
        contentType: 'image/jpeg',
      });

      expect(key).toBe('preferences/u/a.jpg');
      const [command] = mockSend.mock.calls[0] as [{ input: Record<string, unknown> }];
      expect(command.input.Bucket).toBe('tripick-private');
      // 1년 immutable 을 붙이면 서명이 만료된 뒤에도 캐시된 바이트가 계속 보인다.
      expect(String(command.input.CacheControl)).toMatch(/^private,/);
      expect(String(command.input.CacheControl)).not.toContain('immutable');
    });
  });

  describe('signedUrl', () => {
    it('절대 공개 URL 환경(라이브 R2)에서는 presigned 절대 URL 을 그대로 준다', async () => {
      const svc = ready({
        STORAGE_PRIVATE_BUCKET: 'tripick-private',
        STORAGE_PUBLIC_URL: 'https://cdn.tripick.place',
      });
      const url = await svc.signedUrl('preferences/u/a.jpg');
      // R2 presigned 는 S3 API 도메인에서만 동작한다 — 커스텀 도메인으로 바꿔선 안 된다.
      expect(url).toBe(
        'http://localhost:9000/tripick-private/preferences/u/a.jpg?X-Amz-Signature=abc&X-Amz-Expires=900',
      );
    });

    it('상대경로 환경(로컬·웹뷰)에서는 비공개 프록시 경로에 서명 쿼리를 붙인다', async () => {
      const svc = ready({
        STORAGE_PRIVATE_BUCKET: 'tripick-private',
        STORAGE_PUBLIC_URL: '/storage',
      });
      const url = await svc.signedUrl('preferences/u/a.jpg');
      // 공개 프록시(/storage)와 목적지 버킷이 달라 경로를 분리했다.
      expect(url).toBe(
        '/storage-private/preferences/u/a.jpg?X-Amz-Signature=abc&X-Amz-Expires=900',
      );
    });

    it('여러 키를 순서대로 서명하고, 실패한 항목은 null 로 남긴다', async () => {
      const svc = ready({ STORAGE_PRIVATE_BUCKET: 'tripick-private', STORAGE_PUBLIC_URL: '/storage' });
      mockGetSignedUrl.mockRejectedValueOnce(new Error('boom'));
      const urls = await svc.signedUrls(['a', 'b']);

      // 배열 길이가 줄면 호출부가 키와 URL 을 짝지을 수 없다.
      expect(urls).toHaveLength(2);
      expect(urls[0]).toBeNull();
      expect(urls[1]).toContain('/storage-private/b?');
    });
  });
});
