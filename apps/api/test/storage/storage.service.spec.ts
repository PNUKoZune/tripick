/// <reference types="jest" />

import { StorageService } from '../../src/storage/storage.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((input) => ({ __type: 'put', input })),
  DeleteObjectCommand: jest.fn((input) => ({ __type: 'delete', input })),
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
});
