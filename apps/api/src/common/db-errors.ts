/** Postgres unique_violation. 경쟁 삽입을 500 대신 도메인 규칙으로 다루려면 이걸 봐야 한다. */
const UNIQUE_VIOLATION = '23505';

interface PostgresDriverError {
  code?: string;
  detail?: string;
  constraint?: string;
}

function driverErrorOf(error: unknown): PostgresDriverError | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const driverError = (error as { driverError?: unknown }).driverError;
  if (driverError && typeof driverError === 'object') return driverError as PostgresDriverError;
  return error as PostgresDriverError;
}

/**
 * 유니크 제약 위반인지 판정한다. `column` 을 주면 그 컬럼에 대한 위반일 때만 true.
 *
 * 인덱스 이름은 TypeORM 이 해시로 만들어(`IDX_c25bc63d…`) 코드에 박을 수 없다. 대신
 * Postgres 가 주는 detail(`Key ("email")=(a@b.com) already exists.`)에서 컬럼을 읽는다.
 */
export function isUniqueViolation(error: unknown, column?: string): boolean {
  const driverError = driverErrorOf(error);
  if (driverError?.code !== UNIQUE_VIOLATION) return false;
  if (!column) return true;
  return new RegExp(`\\(["']?${column}["']?\\)`, 'i').test(driverError.detail ?? '');
}
