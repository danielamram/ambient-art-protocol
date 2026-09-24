import type { SourceContext } from '@ambient/sdk';

/** The slice of `fetch` the polling sources use, so tests and Node can substitute one. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export function resolveFetch(f: FetchLike | undefined): FetchLike {
  if (f) return f;
  const g = globalThis as { fetch?: FetchLike };
  if (g.fetch) return (url, init) => (g.fetch as FetchLike)(url, init);
  throw new Error('fetch is not available. Pass { fetch } in the source config.');
}

/**
 * GET a JSON document. Aborts with the source (`signal`) or after `timeoutMs`, whichever is first,
 * and rejects on non-2xx responses.
 */
export async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    if (signal.aborted) ac.abort();
    const res = await fetchImpl(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Run `tick` every `everyMs` without overlapping runs. Transient failures are tolerated; after
 * `maxFailures` consecutive failures the source is failed through `ctx.fail`. Returns a teardown.
 */
export function startPolling(
  ctx: Pick<SourceContext<unknown>, 'signal' | 'fail'>,
  everyMs: number,
  tick: () => Promise<void>,
  maxFailures: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  const schedule = () => {
    if (ctx.signal.aborted) return;
    timer = setTimeout(run, everyMs);
  };
  const run = async () => {
    try {
      await tick();
      failures = 0;
    } catch (err) {
      if (ctx.signal.aborted) return;
      failures += 1;
      if (failures >= maxFailures) {
        ctx.fail(err);
        return;
      }
    }
    schedule();
  };
  schedule();
  return () => {
    if (timer !== undefined) clearTimeout(timer);
  };
}
