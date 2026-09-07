import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { createServer } from 'node:http';
import { AppModule } from '../../src/app.module';
import { EmailService } from '../../src/email/email.service';
import { StorageService } from '../../src/storage/storage.service';
import { testDatabaseUrl } from './test-database';
import globalSetup from './global-setup';

/** Real Nest modules, migrations, JWT, PostgreSQL, Redis/BullMQ and Socket.IO.
 * Only external delivery/storage/embedding providers are deterministic local fixtures.
 */
export async function createIntegrationApp() {
  const url = testDatabaseUrl();
  if (!process.env.TEST_REDIS_URL)
    throw new Error('TEST_REDIS_URL must point to an isolated test Redis');
  process.env.DATABASE_URL = url;
  process.env.REDIS_URL = process.env.TEST_REDIS_URL;
  process.env.NODE_ENV = 'test';
  process.env.LLM_PLANNER_ENABLED = 'false';
  process.env.PLACE_RETRIEVAL_AUTO_SEED = 'true';
  for (const key of [
    'KAKAO_REST_API_KEY',
    'NAVER_CLIENT_ID',
    'NAVER_CLIENT_SECRET',
    'KMA_API_KEY',
    'TOUR_API_KEY',
    'SENTRY_DSN',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
  ]) {
    delete process.env[key];
  }
  await globalSetup();
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  } finally {
    await db.end();
  }

  const provider = createServer((req, res) => {
    req.resume();
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        data: [{ embedding: Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)) }],
      }),
    );
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('Provider failed to listen');
  process.env.LLM_EMBEDDING_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  const mail = new Map<string, string>();
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const deleted: string[] = [];
  const storage = {
    isPrivateReady: () => true,
    signedUrls: async (keys: string[]) => keys.map((key) => `/storage-private/${key}`),
    putPrivateObject: async (item: { key: string; body: Buffer; contentType: string }) => {
      objects.set(item.key, item);
    },
    getPrivateObject: async (key: string) => {
      const item = objects.get(key);
      if (!item) throw new Error('Missing object');
      return item;
    },
    deletePrivateObject: async (key: string) => {
      deleted.push(key);
      objects.delete(key);
    },
    keyFromPublicUrl: () => null,
    deleteObject: async () => {},
  };
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({
        sendVerification: async (email: string, link: string) => {
          mail.set(email, link);
        },
        sendPasswordReset: async (email: string, link: string) => {
          mail.set(email, link);
        },
        sendAccountExistsNotice: async () => {},
      })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    const close = async () => {
      await app.close();
      await new Promise<void>((resolve, reject) =>
        provider.close((error) => (error ? reject(error) : resolve())),
      );
    };
    return { app, mail, objects, deleted, close };
  } catch (error) {
    provider.close();
    throw error;
  }
}
