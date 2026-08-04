import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { corsOrigins } from './common/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // SIGTERM(재배포·컨테이너 정지)에 Nest 종료 훅을 태운다. 이게 없으면 @nestjs/bullmq 가
  // onApplicationShutdown 에서 하는 worker.close() 가 아예 호출되지 않아, 진행 중이던 잡이
  // 락 만료 후 stalled 로 잡혀 **처음부터 다시 실행**된다 — 재계획이면 LLM 재생성·일정
  // 재작성·완료 알림이 배포 때마다 한 번 더 도는 셈. 훅을 켜면 진행 중 잡을 마치고 닫는다.
  app.enableShutdownHooks();

  // nginx 등 리버스 프록시 뒤에서 X-Forwarded-For 의 실제 클라이언트 IP 를 신뢰 (레이트리밋 IP 식별용)
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
    // Retry-After 는 CORS 기본 노출 헤더가 아니다. 웹이 크로스 오리진으로 호출하므로
    // 명시하지 않으면 429 재시도 카운트다운이 헤더를 못 읽는다.
    exposedHeaders: ['Retry-After'],
  });

  if (process.env['NODE_ENV'] !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('TriPick API')
      .setDescription('AI 여행 플래너 TriPick REST API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env['PORT'] ?? 4000;
  await app.listen(port);
  console.log(`🚀 TriPick API is running on: http://localhost:${port}/api/v1`);
}

bootstrap();
