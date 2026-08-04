// Sentry 초기화. main.ts 의 **첫 import** 여야 한다 — OpenTelemetry 가 http·express·pg·ioredis 를
// 몽키패치한 뒤에 Nest 가 그 모듈들을 로드해야 자동 계측이 붙는다.
//
// ConfigModule 은 Nest 부트스트랩 시점에야 .env 를 읽으므로 여기선 늦다. 로컬 dev 에서 DSN 이
// 빈 채로 init 되는 걸 막으려고 dotenv 를 직접 태운다(배포 환경은 플랫폼이 주입한 값이 이미 있고,
// dotenv 는 기존 process.env 를 덮어쓰지 않으므로 무해).
import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';

const environment = process.env['SENTRY_ENVIRONMENT'] || process.env['NODE_ENV'] || 'development';

Sentry.init({
  // DSN 이 없으면 SDK 가 no-op 이라 로컬은 그냥 꺼진 채 돈다.
  dsn: process.env['SENTRY_DSN'] || undefined,
  environment,
  // 릴리스가 없으면 Sentry 가 세션(릴리스 헬스)을 통째로 버린다. 웹과 달리 백엔드엔 빌드 플러그인이
  // 없어 자동 주입이 안 되므로 배포 커밋 SHA 를 쓴다 (Railway 가 자동으로 넣어주는 값).
  release: process.env['SENTRY_RELEASE'] || process.env['RAILWAY_GIT_COMMIT_SHA'] || undefined,
  tracesSampler: (ctx) => {
    // Railway 헬스체크가 수십 초마다 때리는 라이브니스는 트레이스로 남길 가치가 없다.
    if (ctx.name.includes('/api/v1/health')) return 0;
    return environment === 'development' ? 1.0 : 0.1;
  },
});
