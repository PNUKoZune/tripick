import { INestApplication, ValidationPipe, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import type { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';
import type { Provider, Type } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { UserEntity } from '../../src/users/user.entity';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://tripick:tripick@localhost:5432/tripick_test';

/**
 * `x-test-user-id` 헤더가 가리키는 사용자를 request.user 에 주입한다.
 * 실제 JwtStrategy 가 UserEntity 전체를 싣는 것과 동일하게, DB 에서 사용자 행을
 * 로드해 넣는다(닉네임·핸들 등에 의존하는 서비스도 그대로 검증 가능). 등록된
 * 사용자가 없으면 최소 `{ id }` 로 폴백한다.
 */
let userResolver: ((id: string) => Promise<unknown>) | null = null;

export const TestAuthGuard: CanActivate = {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = req.headers['x-test-user-id'];
    if (!userId) {
      req.user = undefined;
      return true;
    }
    const resolved = userResolver ? await userResolver(userId) : null;
    req.user = resolved ?? { id: userId };
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

  // UserEntity 가 등록돼 있으면 TestAuthGuard 가 전체 사용자 행을 로드하도록 연결한다.
  if (options.entities.includes(UserEntity)) {
    const users = app.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
    userResolver = (id: string) => users.findOneBy({ id }).then((u) => u ?? null);
  } else {
    userResolver = null;
  }

  return app;
}
