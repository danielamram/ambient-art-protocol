import { describe, expect, it } from 'vitest';
import { QUALITY_LEVELS, QualityController } from '../src/quality.js';

const opts = { downAfterSeconds: 1, upAfterSeconds: 2, warmupSeconds: 1 };

describe('QualityController', () => {
  it('starts at full quality and ignores readings during warmup', () => {
    const q = new QualityController(opts);
    expect(q.level).toBe(QUALITY_LEVELS[0]);
    expect(q.feed(10, 0.5)).toBeUndefined();
    expect(q.feed(10, 0.5)).toBeUndefined();
    expect(q.index).toBe(0);
  });

  it('steps down after sustained low fps, one level at a time', () => {
    const q = new QualityController(opts);
    q.feed(60, 1); // warmup
    expect(q.feed(20, 0.5)).toBeUndefined();
    expect(q.feed(20, 0.5)).toBe(QUALITY_LEVELS[1]);
    expect(q.feed(20, 0.5)).toBeUndefined();
    expect(q.feed(20, 0.5)).toBe(QUALITY_LEVELS[2]);
  });

  it('steps back up only after a longer stretch of high fps', () => {
    const q = new QualityController({ ...opts, initialIndex: 2 });
    q.feed(60, 1);
    expect(q.feed(60, 1)).toBeUndefined();
    expect(q.feed(60, 1)).toBe(QUALITY_LEVELS[1]);
  });

  it('resets evidence when fps sits in the neutral band', () => {
    const q = new QualityController(opts);
    q.feed(60, 1);
    q.feed(20, 0.5);
    q.feed(50, 0.5);
    expect(q.feed(20, 0.5)).toBeUndefined();
  });

  it('stops at the ends of the ladder', () => {
    const q = new QualityController({ ...opts, initialIndex: QUALITY_LEVELS.length - 1 });
    q.feed(60, 1);
    expect(q.feed(5, 5)).toBeUndefined();
    const top = new QualityController(opts);
    top.feed(60, 1);
    expect(top.feed(120, 5)).toBeUndefined();
  });

  it('set() jumps and restarts warmup; bad input is ignored', () => {
    const q = new QualityController(opts);
    expect(q.set(99)).toBe(QUALITY_LEVELS[QUALITY_LEVELS.length - 1]);
    expect(q.feed(Number.NaN, 1)).toBeUndefined();
    expect(q.feed(120, 0)).toBeUndefined();
    expect(q.feed(120, 0.5)).toBeUndefined(); // still warming up
  });
});
