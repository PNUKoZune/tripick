import { INestApplication, ValidationPipe, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';
import type { Provider, Type } from '@nestjs/common';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://tripick:tripick@localhost:5432/tripick_test';

/**
 * 테스트 요청의 `x-test-user-id` 헤더를 그대로 request.user 로 주입하는 스텁 가드.
 * 실제 JWT 스택을 띄우지 않고도 소유권(내 것/남의 것) 분기를 e2e 로 검증할 수 있다.
 */
export const TestAuthGuard: CanActivate = {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const userId = req.headers['x-test-user-id'];
    req.user = userId ? { id: userId } : undefined;
    return true;
  },
};

interface E2EModuleOptions {
  /** 등록할 엔티티 (forFeature + synchronize 대상) */
  entities: EntityClassOrSchema[];
  controllers: Type[];
  providers?: Provider[];
  /** 스텁으로 대체할 가드 클래스 */
  overrideGuards?: Array<{ guard: Type; useValue: CanActivate }>;
}

/**
 * main.ts 의 ValidationPipe 설정을 그대로 재현하되, 필요한 모듈만 담아
 * 테스트 DB 에 연결한 경량 Nest 앱을 부팅한다. 스키마는 매 부팅마다 새로 만든다.
 */
export async function createE2EApp(options: E2EModuleOptions): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url: TEST_DATABASE_URL,
        entities: options.entities,
        synchronize: true,
        dropSchema: true, // 테스트 간 격리: 부팅 시 스키마를 새로 만든다
        logging: false,
      }),
      TypeOrmModule.forFeature(options.entities),
    ],
    controllers: options.controllers,
    providers: options.providers ?? [],
  });

  for (const { guard, useValue } of options.overrideGuards ?? []) {
    builder = builder.overrideGuard(guard).useValue(useValue);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  return app;
}
