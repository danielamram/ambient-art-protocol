/**
 * Resolve when a socket-like object reports `open`, reject when it errors or closes first,
 * or when `timeoutMs` elapses. Wraps the object's own handlers so the caller can still
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
  } = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${what}: no connection after ${timeoutMs} ms`));
    }, timeoutMs);
    socket.onopen = (ev) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve();
      }
      handlers.onOpen?.();
      void ev;
    };
    socket.onerror = (ev) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`${what}: connection failed`));
      }
      handlers.onError?.(ev);
    };
    if ('onclose' in socket) {
      socket.onclose = (ev) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`${what}: closed before connecting`));
        }
        handlers.onClose?.(ev);
      };
    }
  });
}
