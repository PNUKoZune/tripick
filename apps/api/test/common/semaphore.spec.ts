/// <reference types="jest" />

import { Semaphore } from '../../src/common/util/semaphore';

/** 수동으로 완료 시점을 제어하는 deferred. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('Semaphore', () => {
  it('limit 을 넘는 동시 실행을 막는다', async () => {
    const sem = new Semaphore(1);
    const a = deferred();
    const b = deferred();
    let aStarted = false;
    let bStarted = false;

    const runA = sem.run(async () => {
      aStarted = true;
      await a.promise;
    });
    const runB = sem.run(async () => {
      bStarted = true;
      await b.promise;
    });
    await tick();

    expect(aStarted).toBe(true);
    expect(bStarted).toBe(false); // 슬롯이 없어 대기

    a.resolve();
    await runA;
    await tick();
    expect(bStarted).toBe(true); // A 가 끝나야 B 시작

    b.resolve();
    await runB;
  });

  it('예외가 나도 슬롯을 반납한다', async () => {
    const sem = new Semaphore(1);

    await expect(sem.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    // 슬롯이 반납되지 않았다면 여기서 영원히 대기한다.
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('대기는 FIFO 순서로 통과한다', async () => {
    const sem = new Semaphore(1);
    const gate = deferred();
    const order: number[] = [];

    const first = sem.run(async () => {
      await gate.promise;
    });
    const rest = [1, 2, 3].map((n) =>
      sem.run(async () => {
        order.push(n);
      }),
    );

    gate.resolve();
    await Promise.all([first, ...rest]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('limit 2 면 2개까지 동시 실행된다', async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 6 }, () =>
        sem.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await tick();
          running -= 1;
        }),
      ),
    );

    expect(peak).toBe(2);
  });

  it('limit 이 1 미만이면 생성 시 거부한다', () => {
    expect(() => new Semaphore(0)).toThrow();
  });
});
