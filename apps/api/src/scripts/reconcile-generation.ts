import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { GenerationLedgerService } from '../trip-generation/generation-ledger.service';
import { GenerationRequestEntity } from '../trip-generation/generation-request.entity';
import { TripEntity } from '../trips/trip.entity';
import { UserEntity } from '../users/user.entity';

/** Does not bootstrap the application: reconciliation must not accidentally start workers. */
async function main(): Promise<void> {
  const [id, outcome, actor, evidence, ...extra] = process.argv.slice(2);
  if (
    !id ||
    !/^[0-9a-f-]{36}$/i.test(id) ||
    !['failed', 'cancelled', 'quarantine'].includes(outcome ?? '') ||
    !actor?.trim() ||
    actor.length > 200 ||
    !evidence ||
    evidence.trim().length < 12 ||
    evidence.length > 4000 ||
    extra.length
  ) {
    throw new Error(
      'Usage: ops:reconcile-generation <generation-uuid> <quarantine|failed|cancelled> <operator> <incident-or-remote-completion-evidence>',
    );
  }
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required; no implicit database target is allowed');
  const db = new DataSource({
    type: 'postgres',
    url,
    entities: [UserEntity, TripEntity, GenerationRequestEntity],
    synchronize: false,
    migrationsRun: false,
  });
  await db.initialize();
  try {
    const ledger = new GenerationLedgerService(db, new ConfigService());
    const record = JSON.stringify({
      actor: actor.trim(),
      evidence: evidence.trim(),
      recordedAt: new Date().toISOString(),
    });
    if (outcome === 'quarantine') await ledger.quarantine(id, record);
    else await ledger.reconcile(id, record, outcome as 'failed' | 'cancelled');
    process.stdout.write(
      JSON.stringify({
        event: outcome === 'quarantine' ? 'generation_quarantined' : 'generation_reconciled',
        generationId: id,
        outcome,
      }) + '\n',
    );
  } finally {
    await db.destroy();
  }
}

void main().catch(() => {
  // Database errors can contain connection details. Keep stderr free of credentials.
  process.stderr.write(
    'Generation reconciliation failed. Check the explicit database target, request state and evidence.\n',
  );
  process.exitCode = 1;
});
