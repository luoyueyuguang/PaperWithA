// pdf.js v4 依赖 Promise.withResolvers，Node 20 还没有，这里补一个最小实现。
if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((innerResolve, innerReject) => {
      resolve = innerResolve;
      reject = innerReject;
    });
    return { promise, resolve, reject };
  };
}
