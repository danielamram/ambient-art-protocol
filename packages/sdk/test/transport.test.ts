import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type VisualSignal } from '../src/protocol.js';
import { InMemoryTransport } from '../src/transport.js';

const sig: VisualSignal = {
  v: PROTOCOL_VERSION,
  sourceId: 'x',
  ts: 0,
  type: 'pulse',
  magnitude: 1,
};

describe('InMemoryTransport', () => {
  it('delivers to every subscriber', () => {
    const t = new InMemoryTransport();
    const a = vi.fn();
    const b = vi.fn();
    t.subscribe(a);
    t.subscribe(b);
    t.publish(sig);
    expect(a).toHaveBeenCalledWith(sig);
    expect(b).toHaveBeenCalledWith(sig);
  });

  it('stops delivering after unsubscribe', () => {
    const t = new InMemoryTransport();
    const a = vi.fn();
    const off = t.subscribe(a);
    off();
    t.publish(sig);
    expect(a).not.toHaveBeenCalled();
  });

  it('ignores publish after close', () => {
    const t = new InMemoryTransport();
    const a = vi.fn();
    t.subscribe(a);
    t.close();
    t.publish(sig);
    expect(a).not.toHaveBeenCalled();
    expect(t.closed).toBe(true);
    expect(() => t.close()).not.toThrow();
  });
});
