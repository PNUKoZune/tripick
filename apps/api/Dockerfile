# syntax=docker/dockerfile:1
#
# TriPick API (NestJS) — pnpm workspace + Turborepo 멀티스테이지 빌드.
# 빌드 컨텍스트는 모노레포 루트여야 한다 (pnpm-lock·packages/* 접근 필요):
#   docker build -f apps/api/Dockerfile -t tripick-api .
#
# 런타임 번들은 `pnpm deploy` 로 만든다 — dist + 프로덕션 node_modules +
# @tripick/types·@tripick/utils 의 빌드 산출물(dist)을 주입한 자립 디렉터리.

# ---- Base: Node 20 (.nvmrc) + corepack(pnpm) ----
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# ---- Builder: 의존성 설치 → api(+types·utils) 빌드 → 프로덕션 번들 추출 ----
FROM base AS builder

# 네이티브 모듈(bcrypt·msgpackr-extract 등) 프리빌드 실패 시 컴파일 폴백용.
# 빌더 스테이지에만 두고 최종 이미지에는 남기지 않는다.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# 1) 매니페스트만 먼저 복사 → 소스가 바뀌어도 의존성 레이어는 캐시 재사용.
#    lockfile 정합성을 위해 모든 워크스페이스 package.json 을 함께 둔다.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
RUN pnpm install --frozen-lockfile

# 2) 소스 복사 후 빌드. turbo 가 의존 그래프에 따라 types·utils 를 먼저 빌드한다.
COPY . .
RUN pnpm turbo run build --filter=@tripick/api

# 3) 프로덕션 전용 자립 번들 생성 (/app 에 dist + prod deps).
RUN pnpm --filter=@tripick/api deploy --prod /app

# ---- Runner: 번들만 담은 경량 런타임 ----
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app ./

# 비루트 실행 (node:* 이미지에 기본 제공되는 node 유저)
USER node

# 기본 4000. Railway 등은 PORT 를 주입하며 main.ts 가 이를 우선한다.
EXPOSE 4000

# 컨테이너 자체 헬스체크 (Railway 헬스체크와 별개). curl 없이 node 로 확인.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
