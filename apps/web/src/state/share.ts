/** The slice of `navigator` used for sharing. Injected, so every path is testable in Node. */
export interface ShareEnvironment {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
}

export type ShareOutcome =
  | 'shared'
  | 'copied'
  /** The user dismissed the native share sheet. Not an error. */
  | 'cancelled'
  /** Neither sharing nor the clipboard worked: show the text for manual copying. */
  | 'manual';

const isAbort = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';

/** Copy text; resolves 'copied' only after the clipboard promise has actually resolved. */
export async function copyText(env: ShareEnvironment, text: string): Promise<'copied' | 'manual'> {
  if (!env.clipboard) return 'manual';
  try {
    await env.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'manual';
  }
}

/**
 * Native share sheet when available (must be called from a user gesture), otherwise the
 * clipboard. A share failure other than cancellation falls back to copying.
 */
export async function shareLink(
  env: ShareEnvironment,
  url: string,
  title: string,
): Promise<ShareOutcome> {
  if (env.share) {
    try {
      await env.share({ title, url });
      return 'shared';
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
    }
  }
  return copyText(env, url);
}
