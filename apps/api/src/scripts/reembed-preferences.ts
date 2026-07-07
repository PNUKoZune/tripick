/**
 * 저장된 모든 사용자 취향을 현재 임베딩 소스로 다시 임베딩해 preference_embeddings 를 갱신하는 CLI.
 *
 * 실행:
 *   cd apps/api && pnpm reembed:preferences
 *   cd apps/api && pnpm reembed:preferences -- --allow-hash   # 임베딩 서버 없이 강행
 *
 * 안전장치: 기본적으로 임베딩 서버가 실제 벡터를 주지 못하면(해시 폴백) 중단한다. --allow-hash 로 우회.
 *
 * place 의 `ingest:places --reseed` 와 짝이 되는 취향 측 재시드 도구.
 * 임베딩 모델 서버를 전환했을 때(예: 해시 폴백 → 실제 임베딩) 취향 벡터를
 * place 벡터와 같은 공간으로 재생성한다. 서버 전환 시 두 도구를 함께 실행할 것.
 *
 * AppModule 전체(BullMQ/Redis)를 띄우지 않고 경량 PreferenceReembedModule 로 동작한다.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PreferenceReembedModule } from '../preferences/preference-reembed.module';
import { PreferenceReembedService } from '../preferences/preference-reembed.service';

async function main() {
  const allowHash = process.argv.slice(2).includes('--allow-hash');
  const app = await NestFactory.createApplicationContext(PreferenceReembedModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const service = app.get(PreferenceReembedService);
    const summary = await service.reembedAll({ allowHash });

    console.log('\n=== 취향 재임베딩 요약 ===');
    console.log(
      `총 ${summary.total}건 | 갱신 ${summary.updated}건 | 건너뜀 ${summary.skipped}건 | 실패 ${summary.failed}건`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('재임베딩 실패:', err);
    process.exit(1);
  });
