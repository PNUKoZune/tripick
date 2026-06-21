import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * S3 호환 객체 스토리지 (로컬 MinIO / 라이브 Cloudflare R2).
 *
 * 키 규칙은 호출자가 결정한다. `profiles/<userId>/<timestamp>.<ext>` 같은 형태.
 * MinIO 의 `public/` 프리픽스는 docker-compose 에서 익명 다운로드가 허용돼 있다.
 * 그 외 키는 인증된 presigned URL 로 접근해야 하지만, MVP 에선 프로필 이미지를
 * `public/` 하위로 저장해 그대로 노출한다.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client?: S3Client;
  private bucket?: string;
  private publicUrlBase?: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const endpoint = this.config.get<string>('STORAGE_ENDPOINT');
    const accessKeyId = this.config.get<string>('STORAGE_ACCESS_KEY');
    const secretAccessKey = this.config.get<string>('STORAGE_SECRET_KEY');
    const bucket = this.config.get<string>('STORAGE_BUCKET');
    const publicUrl = this.config.get<string>('STORAGE_PUBLIC_URL');

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      this.logger.warn(
        'Storage env not fully configured — upload endpoints will return 503',
      );
      return;
    }

    this.client = new S3Client({
      endpoint,
      region: 'auto',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    this.bucket = bucket;
    this.publicUrlBase = publicUrl ?? `${endpoint}/${bucket}`;
    this.logger.log(`Storage initialized (bucket=${bucket})`);
  }

  isReady(): boolean {
    return Boolean(this.client && this.bucket);
  }

  async putObject(params: {
    key: string;
    body: Buffer;
    contentType: string;
    cacheControl?: string;
  }): Promise<string> {
    if (!this.client || !this.bucket) {
      throw new Error('Storage is not configured');
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        CacheControl: params.cacheControl ?? 'public, max-age=31536000, immutable',
      }),
    );
    return this.publicUrl(params.key);
  }

  async deleteObject(key: string): Promise<void> {
    if (!this.client || !this.bucket) return;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to delete object ${key}: ${(err as Error).message}`,
      );
    }
  }

  publicUrl(key: string): string {
    return `${this.publicUrlBase}/${key}`;
  }

  /** 우리가 발급한 public URL 인지 확인하고 키만 추출. 외부 URL(카카오 등) 은 null. */
  keyFromPublicUrl(url: string): string | null {
    if (!this.publicUrlBase) return null;
    if (!url.startsWith(`${this.publicUrlBase}/`)) return null;
    return url.slice(this.publicUrlBase.length + 1);
  }
}
