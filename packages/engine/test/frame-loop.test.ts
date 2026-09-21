import { describe, expect, it, vi } from 'vitest';
import { FrameLoop } from '../src/frame-loop.js';

/** A manual scheduler: frames fire only when the test calls `pump(nowMs)`. */
function manualScheduler() {
  let pending: ((nowMs: number) => void) | undefined;
  let cancelled = 0;
  return {
    schedule: (cb: (nowMs: number) => void) => {
      pending = cb;
      return () => {
        cancelled += 1;
        pending = undefined;
      };
    },
    pump: (nowMs: number) => {
      const cb = pending;
      pending = undefined;
      cb?.(nowMs);
    },
    get hasPending() {
      return pending !== undefined;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

describe('FrameLoop', () => {
  it('reports dt in seconds, 0 on the first frame, and re-arms itself', () => {
    const s = manualScheduler();
    const frames: [number, number][] = [];
    const loop = new FrameLoop((dt, now) => frames.push([dt, now]), {
      schedule: s.schedule,
    }).start();
    expect(loop.running).toBe(true);
    s.pump(1000);
    s.pump(1016);
    s.pump(1050);
    expect(frames).toEqual([
      [0, 1],
      [expect.closeTo(0.016, 6), 1.016],
      [expect.closeTo(0.034, 6), 1.05],
    ]);
    expect(s.hasPending).toBe(true);
  });

  it('clamps dt to maxDt after a stall', () => {
    const s = manualScheduler();
    const dts: number[] = [];
    new FrameLoop((dt) => dts.push(dt), { schedule: s.schedule, maxDt: 0.1 }).start();
    s.pump(0);
    s.pump(5000);
    expect(dts[1]).toBe(0.1);
  });

  it('stop() cancels the pending frame and ignores late callbacks', () => {
    const s = manualScheduler();
    const onFrame = vi.fn();
    const loop = new FrameLoop(onFrame, { schedule: s.schedule }).start();
    loop.stop();
    expect(loop.running).toBe(false);
    expect(s.cancelled).toBe(1);
    expect(s.hasPending).toBe(false);
    s.pump(10);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('start() is idempotent and stop() from inside a frame halts the loop', () => {
    const s = manualScheduler();
    let loop: FrameLoop;
    const onFrame = vi.fn(() => loop.stop());
    loop = new FrameLoop(onFrame, { schedule: s.schedule }).start().start();
    s.pump(0);
    expect(onFrame).toHaveBeenCalledOnce();
    expect(s.hasPending).toBe(false);
  });

  it('falls back to a timer outside a browser', () => {
    vi.useFakeTimers();
    try {
      const onFrame = vi.fn();
      const loop = new FrameLoop(onFrame).start();
      vi.advanceTimersByTime(16);
      vi.advanceTimersByTime(16);
      expect(onFrame).toHaveBeenCalledTimes(2);
      loop.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
