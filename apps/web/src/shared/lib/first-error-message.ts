/** 여러 mutation 에러 중 첫 번째 Error 의 message 를 반환. 모두 null 이면 null. */
export function firstErrorMessage(errors: ReadonlyArray<unknown>): string | null {
  for (const err of errors) {
    if (err instanceof Error) return err.message;
  }
  return null;
}
