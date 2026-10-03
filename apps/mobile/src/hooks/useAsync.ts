import { useCallback, useEffect, useState } from "react";

import { describeError } from "../client";

export interface AsyncState<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => void;
}

/**
 * 加载一次远端数据，附带 loading / error / 重试。
 * 重新加载时保留上一次成功的数据，方便列表刷新时不清空界面。
 */
export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader().then(
      (value) => {
        if (cancelled) return;
        setData(value);
        setLoading(false);
      },
      (reason: unknown) => {
        if (cancelled) return;
        setError(describeError(reason));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
    // loader 每次渲染都是新函数，用调用方给的 deps + nonce 控制重跑时机。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, loading, error, reload };
}
