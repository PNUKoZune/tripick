/**
 * 동시 실행 수를 제한하는 세마포어.
 *
 * 동시성을 못 견디는 외부 의존(예: OTP)을 감쌀 때 쓴다. 대기는 FIFO 라 먼저 온
 * 요청이 먼저 통과한다.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (limit < 1) throw new Error('Semaphore limit 은 1 이상이어야 합니다.');
  }

  /** 슬롯을 얻을 때까지 대기한 뒤 fn 을 실행하고, 끝나면(실패해도) 슬롯을 반납한다. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** 대기 중인 호출 수 (백프레셔 관측용). */
  get pending(): number {
    return this.waiters.length;
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    // 대기자를 깨울 때 active 를 넘기지 않고, 깨어난 쪽이 직접 active 를 올린다.
    this.waiters.shift()?.();
  }
}
