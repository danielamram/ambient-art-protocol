import { DataSignalBus, type VisualSignal } from '@ambient/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketInstance } from '../src/binance-trades.js';
import {
  activityPulse,
  blueskyJetstream,
  classifyEvent,
  containsWord,
  emojiBalance,
  jetstreamUrl,
  languagePoint,
} from '../src/bluesky-jetstream.js';

class FakeWebSocket implements WebSocketInstance {
  static instances: FakeWebSocket[] = [];
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  open(): void {
    this.onopen?.({});
  }
  emit(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  close(): void {
    this.closed = true;
  }
}

const post = (text: string, langs: string[] = ['en']) => ({
  did: 'did:plc:x',
  time_us: 1,
  kind: 'commit',
  commit: {
    operation: 'create',
    collection: 'app.bsky.feed.post',
    record: { $type: 'app.bsky.feed.post', text, langs },
  },
});
const follow = () => ({
  kind: 'commit',
  commit: { operation: 'create', collection: 'app.bsky.graph.follow', record: {} },
});

describe('Jetstream helpers', () => {
  it('keeps only created posts, reposts, follows and likes', () => {
    expect(classifyEvent(post('hi', ['pt-BR']))).toEqual({ kind: 'post', text: 'hi', lang: 'pt' });
    expect(classifyEvent(follow())).toMatchObject({ kind: 'follow', text: '' });
    expect(classifyEvent({ kind: 'identity' })).toBeNull();
    expect(
      classifyEvent({
        kind: 'commit',
        commit: { operation: 'delete', collection: 'app.bsky.feed.post' },
      }),
    ).toBeNull();
    expect(
      classifyEvent({
        kind: 'commit',
        commit: { operation: 'create', collection: 'app.bsky.actor.profile' },
      }),
    ).toBeNull();
  });

  it('places each language in its own zone', () => {
    const en1 = languagePoint('en', 'a');
    const en2 = languagePoint('en', 'b');
    const ja = languagePoint('ja', 'a');
    expect(Math.hypot(en1.x - en2.x, en1.y - en2.y)).toBeLessThan(0.12);
    expect(Math.hypot(en1.x - ja.x, en1.y - ja.y)).toBeGreaterThan(0.01);
    for (const p of [en1, en2, ja]) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
    }
  });

  it('counts warm and cold emoji, including variation-selector forms', () => {
    expect(emojiBalance('love this ❤️❤️ ✨ but 😢')).toEqual({ warm: 3, cold: 1 });
    expect(emojiBalance('plain')).toEqual({ warm: 0, cold: 0 });
  });

  it('matches whole words, case-insensitively, in any script', () => {
    expect(containsWord('More RAIN tonight', 'rain')).toBe(true);
    expect(containsWord('it is raining', 'rain')).toBe(false);
    expect(containsWord('#rain!', 'rain')).toBe(true);
    expect(containsWord('大雨 rain? 雨', '雨')).toBe(true);
    expect(containsWord('a+b', 'a+b')).toBe(true);
    expect(containsWord('anything', '  ')).toBe(false);
  });

  it('sizes pulses by kind, with watched matches strongest', () => {
    const long = activityPulse({ kind: 'post', text: 'x'.repeat(300), lang: 'en' }, false);
    const short = activityPulse({ kind: 'post', text: 'x', lang: 'en' }, false);
    expect(long).toBeGreaterThan(short);
    expect(activityPulse({ kind: 'follow', text: '', lang: '' }, false)).toBeLessThan(short);
    expect(activityPulse({ kind: 'post', text: 'x', lang: 'en' }, true)).toBe(0.85);
  });

  it('subscribes only to the requested collections', () => {
    expect(jetstreamUrl('wss://h/subscribe', ['post', 'follow'])).toBe(
      'wss://h/subscribe?wantedCollections=app.bsky.feed.post&wantedCollections=app.bsky.graph.follow',
    );
  });
});

describe('blueskyJetstream source', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  async function live(watch?: () => string) {
    let now = 0;
    const bus = new DataSignalBus({ now: () => now });
    const seen: VisualSignal[] = [];
    bus.stream$.subscribe((s) => seen.push(s));
    const src = blueskyJetstream({
      WebSocket: FakeWebSocket,
      maxPulsesPerSecond: 2,
      ...(watch ? { watch } : {}),
    });
    const starting = src.start(bus);
    const ws = FakeWebSocket.instances[0] as FakeWebSocket;
    ws.open();
    await starting;
    return {
      src,
      ws,
      seen,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it('samples busy streams, emits ambiance from emoji balance, and closes on stop', async () => {
    const h = await live();
    expect(h.ws.url).toContain('wantedCollections=app.bsky.feed.post');
    expect(h.ws.url).not.toContain('app.bsky.feed.like');
    for (let i = 0; i < 10; i++) h.ws.emit(post(`happy ✨❤️ ${i}`));
    // 2 per second at most: the first passes, the rest in the same instant are sampled away.
    expect(h.seen.filter((s) => s.type === 'pulse')).toHaveLength(1);
    h.advance(600);
    h.ws.emit(post('again'));
    expect(h.seen.filter((s) => s.type === 'pulse')).toHaveLength(2);
    h.ws.emit('not json');
    await vi.advanceTimersByTimeAsync(1500);
    const amb = h.seen.find((s) => s.type === 'ambiance');
    expect(amb).toMatchObject({ moodScore: expect.closeTo(21 / 22, 5) });
    await h.src.stop();
    expect(h.ws.closed).toBe(true);
  });

  it('with a watched word, only matching posts pulse, and strongly; the word can change live', async () => {
    let word = 'rain';
    const h = await live(() => word);
    h.ws.emit(post('sunny day'));
    h.ws.emit(post('Rain again!'));
    h.ws.emit(post('rain rain rain'));
    h.ws.emit(follow());
    const pulses = () => h.seen.filter((s) => s.type === 'pulse');
    expect(pulses()).toHaveLength(2);
    expect(pulses()[0]).toMatchObject({ magnitude: 0.85 });
    word = '';
    h.advance(1000);
    h.ws.emit(post('sunny day'));
    expect(pulses()).toHaveLength(3);
    await h.src.stop();
  });

  it('fails when a live connection closes, and stops promptly while connecting', async () => {
    const h = await live();
    h.ws.onclose?.({ code: 1006 });
    expect(h.src.status).toBe('error');

    const src = blueskyJetstream({ WebSocket: FakeWebSocket });
    const starting = src.start(new DataSignalBus());
    await src.stop();
    await expect(starting).resolves.toBeUndefined();
    expect(src.status).toBe('stopped');
    expect(FakeWebSocket.instances.at(-1)?.closed).toBe(true);
  });
});
