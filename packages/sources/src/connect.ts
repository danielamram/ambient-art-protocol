/**
 * Resolve when a socket-like object reports `open`, reject when it errors or closes first,
 * when `timeoutMs` elapses, or immediately when `handlers.signal` aborts. Wraps the object's own handlers so the caller can still
 * receive open/error/close after connection.
 */
export interface Openable {
  onopen: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose?: ((ev: unknown) => void) | null;
}

export function waitForOpen(
  socket: Openable,
  what: string,
  timeoutMs: number,
  handlers: {
    onOpen?: () => void;
    onError?: (ev: unknown) => void;
    onClose?: (ev: unknown) => void;
    /**
     * Abort the wait (e.g. the source's `ctx.signal`). Rejects at once with an `AbortError`
     * instead of waiting for open, error, close or the timeout. The caller closes the socket.
     */
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const { signal } = handlers;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(abortError(what));
    };
    const settle = () => {
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settle();
      reject(new Error(`${what}: no connection after ${timeoutMs} ms`));
    }, timeoutMs);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.onopen = (ev) => {
      if (!settled) {
        settle();
        resolve();
      }
      handlers.onOpen?.();
      void ev;
    };
    socket.onerror = (ev) => {
      if (!settled) {
        settle();
        reject(new Error(`${what}: connection failed`));
      }
      handlers.onError?.(ev);
    };
    if ('onclose' in socket) {
      socket.onclose = (ev) => {
        if (!settled) {
          settle();
          reject(new Error(`${what}: closed before connecting`));
        }
        handlers.onClose?.(ev);
      };
    }
  });
}

function abortError(what: string): Error {
  const err = new Error(`${what}: connection attempt aborted`);
  err.name = 'AbortError';
  return err;
}
