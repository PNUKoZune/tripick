/**
 * 응답이 영영 안 올 수 있는 Promise 에 상한을 건다.
 *
 * 특히 BullMQ `queue.add` 는 Redis 가 죽어 있어도 던지지 않고 ioredis 오프라인 큐에
 * 버퍼링되어 resolve/reject 둘 다 하지 않는다. 그대로 await 하면 부팅이나 HTTP 요청이
 * 통째로 멈추므로(try/catch 로도 못 잡는다) 이 헬퍼로 감싸야 한다.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = '응답 없음'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} (${ms}ms 초과)`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
