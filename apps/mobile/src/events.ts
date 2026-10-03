import type { CoreEvent } from "@paperwitha/domain";

import { core } from "./client";

type CoreEventListener = (event: CoreEvent) => void;

const listeners = new Set<CoreEventListener>();
let subscription: { close: () => void } | null = null;

/**
 * 多个界面共享一条 core 事件流。CoreClient 只支持一个订阅回调，
 * 所以这里做一层分发：有监听者时才建立 WS，最后一个监听者离开时关闭。
 */
export function subscribeCoreEvents(listener: CoreEventListener): () => void {
  if (subscription === null) {
    subscription = core.subscribe((event) => {
      for (const current of [...listeners]) current(event);
    });
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && subscription !== null) {
      subscription.close();
      subscription = null;
    }
  };
}
