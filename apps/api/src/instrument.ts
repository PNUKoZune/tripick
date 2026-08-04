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
  // 나가는 요청에 트레이스 헤더(`sentry-trace`·`baggage`)를 붙일 대상. 기본값은 "전부"인데,
  // data.go.kr 게이트웨이가 **헤더 값에 `nvironment=` 문자열이 있으면** HTTP 400
  // INVALID_REQUEST_PARAMETER_ERROR 로 거절한다 — `baggage` 에 항상 들어가는
  // `sentry-environment=...` 가 그대로 걸려 한국관광공사(지역 목록·관광정보·집중률)와
  // 기상청 단기예보 호출이 전부 죽었다. WAF 규칙이라 파라미터·키와 무관하게 재현된다.
  // 백엔드가 호출하는 외부 API 는 어차피 Sentry 계측 대상이 아니라 트레이스를 이어붙일 이유가
  // 없으므로, 우리 서비스(로컬 LLM·오브젝트 스토리지)로만 전파를 제한한다.
  // 수신 쪽(web → api) 분산 트레이스는 이 옵션과 무관하게 계속 이어진다.
  tracePropagationTargets: [/^\//, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/],
});
