/// <reference types="jest" />

import { isUniqueViolation } from '../../src/common/db-errors';

/** TypeORM QueryFailedError 모양(driverError 안에 Postgres 원본). */
function queryFailed(code: string, detail: string) {
  return { name: 'QueryFailedError', driverError: { code, detail } };
}

describe('isUniqueViolation', () => {
  const emailConflict = queryFailed(
    '23505',
    'Key ("email")=(a@b.com) already exists.',
  );

  it('detects a unique violation', () => {
    expect(isUniqueViolation(emailConflict)).toBe(true);
  });

  // 인덱스 이름은 TypeORM 이 해시로 만들어 코드에 박을 수 없다 — detail 의 컬럼명으로 가른다.
  it('tells columns apart', () => {
    expect(isUniqueViolation(emailConflict, 'email')).toBe(true);
    expect(isUniqueViolation(emailConflict, 'handle')).toBe(false);
    expect(isUniqueViolation(queryFailed('23505', 'Key ("handle")=(bob) already exists.'), 'handle')).toBe(
      true,
    );
  });

  it('ignores other database errors', () => {
    expect(isUniqueViolation(queryFailed('23503', 'foreign key'))).toBe(false);
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it('reads a bare driver error too (driverError 없이 올라오는 경로)', () => {
    expect(isUniqueViolation({ code: '23505', detail: 'Key ("email")=(x) already exists.' }, 'email')).toBe(
      true,
    );
  });
});
