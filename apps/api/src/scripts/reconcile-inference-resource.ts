/** Operations CLI: inspect by default; --apply requires remote termination and previous owner-stop evidence. */
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import dataSource from '../database/data-source';
import { InferenceResourceService, type ReconciliationEvidence } from '../inference-resource/inference-resource.service';

async function main(): Promise<void> {
  const flags = new Map(process.argv.slice(2).map((arg) => {
    const index = arg.indexOf('=');
    return index === -1 ? [arg, ''] : [arg.slice(0, index), arg.slice(index + 1)];
  }));
  const resourceKey = flags.get('--resource-key');
  if (!resourceKey) throw new Error('--resource-key is required');
  await dataSource.initialize();
  try {
    if (!flags.has('--apply')) {
      const rows: unknown[] = await dataSource.query(
        `SELECT r.*, e."requestId", e.attempt, e."startedAt", e."endedAt", e."heartbeatAt", e.evidence
         FROM inference_resources r LEFT JOIN inference_model_executions e ON e.id = r."activeExecutionId"
         WHERE r."resourceKey" = $1`, [resourceKey],
      );
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    const executionId = flags.get('--execution-id');
    const actor = flags.get('--actor');
    const confirmation = flags.get('--confirmation');
    const reference = flags.get('--evidence');
    const ownerStopReference = flags.get('--owner-stop-evidence');
    const ownerStopped = flags.has('--owner-stopped') && ['', 'true'].includes(flags.get('--owner-stopped') ?? '');
    if (!executionId || !actor || !reference || !ownerStopped || !ownerStopReference ||
        !['model-server-restarted', 'remote-completion-confirmed'].includes(confirmation ?? '')) {
      throw new Error('--apply requires --execution-id, --actor, --evidence, --confirmation=model-server-restarted|remote-completion-confirmed, --owner-stopped and --owner-stop-evidence');
    }
    const gate = new InferenceResourceService(dataSource, new ConfigService(process.env));
    await gate.reconcile({
      resourceKey, executionId, actor, reference,
      confirmation: confirmation as ReconciliationEvidence['confirmation'],
      ownerStopped: true, ownerStopReference,
    });
    console.log(`Reconciled ${resourceKey} execution ${executionId}; operator evidence recorded.`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
