/** Offline only: pnpm eval:planning -- --output=/absolute/path/planning-eval.json */
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { planningEvaluationFixtures } from './planning-eval/fixtures';
import { runPlanningEvaluation } from './planning-eval/runner';

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((argument) => argument !== '--');
  const outputArg = args.find((argument) => argument.startsWith('--output='));
  const outputIndex = args.indexOf('--output');
  const output =
    outputArg?.slice('--output='.length) ?? (outputIndex >= 0 ? args[outputIndex + 1] : undefined);
  if (args.some((argument) => argument === '--help' || argument === '-h')) {
    process.stdout.write(
      'Offline synthetic evaluation. Usage: pnpm eval:planning -- --output=/absolute/path/report.json\n',
    );
    return;
  }
  // Invalid synthetic fixtures are deliberate benchmark inputs; diagnostics are in the JSON.
  Logger.overrideLogger(['error']);
  const result = await runPlanningEvaluation(planningEvaluationFixtures());
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (output) {
    const path = resolve(output);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, json, 'utf8');
    process.stdout.write(
      `${JSON.stringify({ output: path, totals: result.totals, splits: result.splits }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(json);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
