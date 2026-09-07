/** Destructive test setup must never accept a development/production database URL. */
export function testDatabaseUrl(): string {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgresql://tripick:tripick@localhost:5432/tripick_test';
  const name = new URL(url).pathname.slice(1);
  if (!/^[a-zA-Z0-9_]+_test$/.test(name))
    throw new Error('TEST_DATABASE_URL must name a database ending in _test');
  return url;
}
