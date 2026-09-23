import { describe, expect, it } from 'vitest';
import { copyText, shareLink } from '../src/state/share.js';

const abort = () => Promise.reject(new DOMException('dismissed', 'AbortError'));

describe('shareLink', () => {
  it('uses the native share sheet when available', async () => {
    const shared: unknown[] = [];
    const outcome = await shareLink(
      { share: async (d) => void shared.push(d) },
      'https://x/#look=1',
      'Look',
    );
    expect(outcome).toBe('shared');
    expect(shared).toEqual([{ title: 'Look', url: 'https://x/#look=1' }]);
  });

  it('treats a dismissed share sheet as cancellation, not an error, and does not copy', async () => {
    let copied = false;
    const outcome = await shareLink(
      {
        share: abort,
        clipboard: {
          writeText: async () => {
            copied = true;
          },
        },
      },
      'u',
      't',
    );
    expect(outcome).toBe('cancelled');
    expect(copied).toBe(false);
  });

  it('falls back to the clipboard when sharing fails for another reason', async () => {
    const outcome = await shareLink(
      {
        share: () => Promise.reject(new DOMException('no', 'NotAllowedError')),
        clipboard: { writeText: async () => undefined },
      },
      'u',
      't',
    );
    expect(outcome).toBe('copied');
  });

  it('asks for manual copying when the clipboard rejects or is missing', async () => {
    expect(
      await shareLink({ clipboard: { writeText: () => Promise.reject(new Error()) } }, 'u', 't'),
    ).toBe('manual');
    expect(await copyText({}, 'u')).toBe('manual');
  });
});
