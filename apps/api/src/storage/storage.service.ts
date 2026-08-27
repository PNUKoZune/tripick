import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * S3 호환 객체 스토리지 (로컬 MinIO / 라이브 Cloudflare R2).
 *
 * **버킷 2개로 공개 여부를 가른다.** 프리픽스로 가르지 않는 이유: R2 는 프리픽스 단위 접근
 * 정책이 없고, 버킷에 커스텀 도메인(`cdn.tripick.place`)이 붙으면 **키를 아는 사람이 버킷
 * 전체를 읽는다.** `public/` 규칙은 MinIO 의 `mc anonymous set download` 가 만든 로컬 전용
 * 정책이라 라이브에서는 아무 보호가 아니었다.
 *
 * - `STORAGE_BUCKET` — 공개. 커스텀 도메인이 앞에 붙어 CDN 으로 서빙된다.
 *   프로필 이미지가 여기 있다: 친구·여행 멤버에게 보여야 하고 사용자가 스스로 공개하는
 *   아바타다. `publicUrl()` 로 영구 URL 을 만든다.
 * - `STORAGE_PRIVATE_BUCKET` — 비공개. **커스텀 도메인을 붙이지 않는다**(붙이면 presigned
 *   가 무의미해진다 — R2 presigned 는 S3 API 도메인에서만 동작한다). 취향 사진이 여기 있다:
 *   본인만 보는 개인 사진이라 URL 이 한 번 새면 영구 열람이 되는 공개 버킷에 둘 수 없다.
 *   `signedUrl()` 로 만든 **만료되는** URL 로만 읽는다.
 *
 * ⚠️ 비공개 버킷이 설정돼 있지 않으면 비공개 업로드는 **실패한다.** 공개 버킷으로 조용히
 * 폴백하지 않는다 — 그 폴백이 곧 이 변경으로 막으려는 노출이다.
 */
const SIGNED_URL_TTL_SEC = 15 * 60;

/**
 * 로컬에서 비공개 오브젝트를 웹뷰에 보여줄 때 타는 web 프록시 경로.
 * `apps/web/next.config.mjs` 의 rewrite 와 **짝**이다 — 한쪽만 바꾸면 이미지가 404 난다.
 * 공개 프록시(`/storage`)와 분리한 이유: rewrite 목적지에 버킷 이름이 박혀 있어서
 * 공개·비공개 버킷을 한 경로로 덮을 수 없다.
 */
const PRIVATE_PROXY_PATH = '/storage-private';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client?: S3Client;
  private bucket?: string;
  private privateBucket?: string;
  private publicUrlBase?: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const endpoint = this.config.get<string>('STORAGE_ENDPOINT');
    const accessKeyId = this.config.get<string>('STORAGE_ACCESS_KEY');
    const secretAccessKey = this.config.get<string>('STORAGE_SECRET_KEY');
    const bucket = this.config.get<string>('STORAGE_BUCKET');
    const privateBucket = this.config.get<string>('STORAGE_PRIVATE_BUCKET');
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
    if (privateBucket) this.privateBucket = privateBucket;
    this.publicUrlBase = publicUrl ?? `${endpoint}/${bucket}`;
    if (!privateBucket) {
      // 취향 사진 업로드가 503 으로 막힌다. 공개 버킷 폴백은 두지 않는다.
      this.logger.warn(
        'STORAGE_PRIVATE_BUCKET 미설정 — 취향 사진 업로드가 비활성화된다(공개 버킷 폴백 없음)',
      );
    }
    this.logger.log(
      `Storage initialized (bucket=${bucket}, private=${privateBucket ?? 'none'})`,
    );
  }

  isReady(): boolean {
    return Boolean(this.client && this.bucket);
  }

  /** 비공개 버킷까지 준비됐는지. 취향 사진 경로가 이걸 본다. */
  isPrivateReady(): boolean {
    return Boolean(this.client && this.privateBucket);
  }

  /** 공개 버킷에 올린다(프로필 이미지). CDN 캐시를 길게 태워도 되는 자산이다. */
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

  /**
   * 객체 본문을 그대로 읽는다.
   * 비동기 잡이 Redis 에 이미지 바이트를 싣지 않고 키만 넘긴 뒤 다시 읽어오는 용도.
   */
  async getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
    if (!this.client || !this.bucket) {
      throw new Error('Storage is not configured');
    }
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!res.Body) {
      throw new Error(`Object has no body: ${key}`);
    }
    const bytes = await res.Body.transformToByteArray();
    return {
      body: Buffer.from(bytes),
      contentType: res.ContentType ?? 'application/octet-stream',
    };
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

  /**
   * 비공개 버킷에 올린다(취향 사진). 키만 돌려준다 — 공개 URL 이 존재하지 않고,
   * 표시용 URL 은 매번 `signedUrl()` 로 새로 만든다.
   *
   * `Cache-Control` 이 공개 업로드와 다르다. 1년 immutable 을 붙이면 서명이 만료된 뒤에도
   * 브라우저·중간 캐시에 남은 바이트가 계속 보여서, 만료가 실질적으로 무의미해진다.
   */
  async putPrivateObject(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<string> {
    const bucket = this.requirePrivateBucket();
    await this.client!.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        CacheControl: `private, max-age=${SIGNED_URL_TTL_SEC}`,
      }),
    );
    return params.key;
  }

  /** 비공개 오브젝트 본문. 분석 잡이 원본을 다시 읽는 용도. */
  async getPrivateObject(key: string): Promise<{ body: Buffer; contentType: string }> {
    const bucket = this.requirePrivateBucket();
    return this.readObject(bucket, key);
  }

  async deletePrivateObject(key: string): Promise<void> {
    if (!this.client || !this.privateBucket) return;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.privateBucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to delete private object ${key}: ${(err as Error).message}`,
      );
    }
  }

  publicUrl(key: string): string {
    return `${this.publicUrlBase}/${key}`;
  }

  /**
   * 비공개 오브젝트의 **만료되는** 읽기 URL. `<img src>` 로 보여줘야 하는데 이미지 요청에는
   * Authorization 헤더를 실을 수 없어서 서명 URL 이 유일한 방법이다.
   *
   * 라이브(R2): `STORAGE_PUBLIC_URL` 이 절대 URL 이므로 **presigned 절대 URL 을 그대로**
   * 돌려준다. R2 presigned 는 S3 API 도메인(`<account>.r2.cloudflarestorage.com`)에서만
   * 동작하고 **커스텀 도메인에서는 안 된다** — 그래서 비공개 버킷에는 도메인을 붙이지 않는다.
   *
   * 로컬: `STORAGE_PUBLIC_URL` 이 상대경로(`/storage`)라 절대 URL 이 웹뷰에서 기기 자신을
   * 가리킨다. 서명 쿼리만 떼어 web 의 **비공개 전용 프록시**(`/storage-private`)에 붙인다.
   *
   * ⚠️ 그 경우 **서명 host 와 프록시 목적지 host 가 정확히 같아야 한다.** SigV4 가 host 를
   * 서명에 포함하므로(`X-Amz-SignedHeaders=host`) `localhost:9000` 으로 서명하고 프록시가
   * `127.0.0.1:9000` 으로 보내면 403 SignatureDoesNotMatch 가 난다(실측 확인). 그래서
   * `STORAGE_ENDPOINT` 와 web 의 `TRIPICK_STORAGE_ORIGIN` 은 host 를 맞춰 둔다.
   */
  async signedUrl(key: string, expiresInSec = SIGNED_URL_TTL_SEC): Promise<string> {
    const bucket = this.requirePrivateBucket();
    const signed = await getSignedUrl(
      this.client!,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: expiresInSec },
    );
    if (!this.publicUrlBase?.startsWith('/')) return signed;
    const { search } = new URL(signed);
    return `${PRIVATE_PROXY_PATH}/${key}${search}`;
  }

  /**
   * 여러 장을 한 번에 서명. 실패한 항목은 빼지 않고 null 로 남긴다 — 배열 길이가 줄면
   * 호출부가 키와 URL 을 짝지을 수 없다.
   */
  async signedUrls(keys: readonly string[]): Promise<Array<string | null>> {
    return Promise.all(
      keys.map((key) =>
        this.signedUrl(key).catch((err: unknown) => {
          this.logger.warn(
            `서명 URL 생성 실패 (${key}): ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }),
      ),
    );
  }

  /** 우리가 발급한 public URL 인지 확인하고 키만 추출. 외부 URL(카카오 등) 은 null. */
  keyFromPublicUrl(url: string): string | null {
    if (!this.publicUrlBase) return null;
    if (!url.startsWith(`${this.publicUrlBase}/`)) return null;
    return url.slice(this.publicUrlBase.length + 1);
  }

  /**
   * 비공개 버킷 이름. 없으면 던진다 — 공개 버킷으로 폴백하면 개인 사진이 CDN 도메인에서
   * 그대로 열리고, 그게 이 구조로 막으려는 노출이다.
   */
  private requirePrivateBucket(): string {
    if (!this.client || !this.privateBucket) {
      throw new Error('Private storage is not configured (STORAGE_PRIVATE_BUCKET)');
    }
    return this.privateBucket;
  }

  private async readObject(
    bucket: string,
    key: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const res = await this.client!.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) {
      throw new Error(`Object has no body: ${key}`);
    }
    const bytes = await res.Body.transformToByteArray();
    return {
      body: Buffer.from(bytes),
      contentType: res.ContentType ?? 'application/octet-stream',
    };
  }
}
