import { ConsoleLogger } from '@nestjs/common';
import { createIntegrationApp } from './integration-app';
import type { Request, Response } from 'express';

async function main() {
  const fixture = await createIntegrationApp();
  fixture.app.useLogger(new ConsoleLogger('BrowserE2E', { logLevels: ['warn', 'error'] }));
  // Test-only mailbox is registered exclusively in this test entrypoint, bound to loopback.
  fixture.app.getHttpAdapter().get('/__test/mail', (req: Request, res: Response) => {
    const link = fixture.mail.get(String(req.query.email));
    res.status(link ? 200 : 404).json({ link });
  });
  await fixture.app.listen(Number(process.env.TEST_API_PORT ?? 4310), '127.0.0.1');
  console.log('Browser E2E API ready');
  const close = async () => {
    await fixture.close();
    process.exit(0);
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
