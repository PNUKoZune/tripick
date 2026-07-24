import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
    origin: process.env['CORS_ORIGIN']?.split(',').map((origin) => origin.trim()) ??
      DEFAULT_CORS_ORIGINS,
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
