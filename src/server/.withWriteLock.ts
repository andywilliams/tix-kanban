// Module-level promise chain to serialize write operations
let writeChain: Promise<any> = Promise.resolve();

async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeChain;
  let resolveNext!: (value: T) => void;
  writeChain = new Promise<T>(resolve => { resolveNext = resolve; });
  try {
    await prev;
    return await fn();
  } finally {
    resolveNext(undefined as T);
  }
}
