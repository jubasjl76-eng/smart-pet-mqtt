import { describe, it, expect } from 'vitest';
import {
  buildTopic, parseTopic, deliveryFor, allOf, kennelWildcard, topicMatches,
  isLegacyTopic, backendSubscriptions, isValidSegment, metricTopic,
} from './topics.js';
import {
  buildFeed, buildDoor, buildOta, buildLwt, buildStatus, buildAck, buildPresence,
  buildAudio, buildLocation, parseCommand, parseStatus, isEnvelope, toMs, commandId,
  copyTrace,
} from './payloads.js';
import { CommandRouter } from './dispatch.js';

describe('topics', () => {
  it('builds and parses the canonical scheme', () => {
    const t = buildTopic('home', 'feeder', 'feeder-01', 'command');
    expect(t).toBe('kennel/home/feeder/feeder-01/command');
    expect(parseTopic(t)).toEqual({ kennelId: 'home', deviceType: 'feeder', deviceId: 'feeder-01', leaf: 'command' });
  });

  it('rejects malformed / legacy topics', () => {
    expect(parseTopic('kennel/home/feeder/feeder-01')).toBeNull();
    expect(parseTopic('dogs/collar-01/location')).toBeNull();
    expect(parseTopic('kennel/home/toaster/x/status')).toBeNull(); // unknown device type
    expect(isLegacyTopic('dogs/collar-01/location')).toBe(true);
    expect(isLegacyTopic('kennel/home/gps/collar-01/location')).toBe(false);
  });

  it('validates segments', () => {
    expect(isValidSegment('feeder-01')).toBe(true);
    expect(isValidSegment('a/b')).toBe(false);
    expect(isValidSegment('')).toBe(false);
    expect(() => buildTopic('home', 'feeder', 'bad id', 'status')).toThrow();
  });

  it('delivery policy matches the contract', () => {
    expect(deliveryFor('command')).toEqual({ qos: 2, retain: false });
    expect(deliveryFor('status')).toEqual({ qos: 1, retain: true });
    expect(deliveryFor('event')).toEqual({ qos: 1, retain: false });
    expect(deliveryFor('temperature')).toEqual({ qos: 1, retain: false });
  });

  it('wildcards', () => {
    expect(allOf('feeder', 'status')).toBe('kennel/+/feeder/+/status');
    expect(kennelWildcard('home')).toBe('kennel/home/#');
    expect(topicMatches('kennel/+/feeder/+/status', 'kennel/home/feeder/f1/status')).toBe(true);
    expect(topicMatches('kennel/+/feeder/+/status', 'kennel/home/water/w1/status')).toBe(false);
    expect(topicMatches('kennel/home/#', 'kennel/home/gps/c1/location')).toBe(true);
    expect(metricTopic('home', 'scale', 's1', 'weight')).toBe('kennel/home/scale/s1/weight');
  });

  it('backend subscription set covers the device types', () => {
    const filters = backendSubscriptions().map((s) => s.filter);
    expect(filters).toContain('kennel/+/feeder/+/status');
    expect(filters).toContain('kennel/+/gps/+/location');
    expect(filters.some((f) => f.includes('/event'))).toBe(true);
  });
});

describe('payloads', () => {
  it('feed command has envelope + typed params + id', () => {
    const c = buildFeed('feeder-01', 'home', 40);
    expect(c).toMatchObject({ command: 'feed', deviceId: 'feeder-01', kennelId: 'home', params: { amount: 40 } });
    expect(typeof c.timestamp).toBe('number');
    expect(typeof c.id).toBe('string');
  });

  it('door / ota / presence / audio / location builders', () => {
    expect(buildDoor('d1', 'home', { action: 'unlock', reason: 'emergency:fire' }).params.action).toBe('unlock');
    expect(buildOta('f1', 'home', { url: 'https://x/fw.bin', version: '2.0.0' }).command).toBe('ota');
    expect(buildPresence('feeder-01', 'home', 'tag-7', -55).tagId).toBe('tag-7');
    expect(buildAudio('cam-1', 'home', 'sess-1', { kind: 'talk', state: 'start' }).signal).toEqual({ kind: 'talk', state: 'start' });
    const loc = buildLocation('c1', 'home', { latitude: 1, longitude: 2, battery: 80 });
    expect(loc).toMatchObject({ latitude: 1, longitude: 2, battery: 80 });
  });

  it('copyTrace moves traceparent/tracestate and ignores absent fields', () => {
    const dst: Record<string, unknown> = { ackId: 'x' };
    copyTrace(dst, { traceparent: '00-abc-def-01', tracestate: 'a=1' });
    expect(dst).toMatchObject({ traceparent: '00-abc-def-01', tracestate: 'a=1' });

    const bare: Record<string, unknown> = {};
    copyTrace(bare, undefined);
    copyTrace(bare, {});
    expect(bare).toEqual({});
  });

  it('lwt is timestamp 0 offline with no extra fields', () => {
    const w = buildLwt('f1', 'home');
    expect(w).toEqual({ deviceId: 'f1', kennelId: 'home', timestamp: 0, status: 'offline' });
  });

  it('status + validation', () => {
    const s = buildStatus({ deviceId: 'f1', kennelId: 'home', status: 'online', rssi: -60, extra: { foodLevel: 72 } });
    expect(parseStatus(s)).toMatchObject({ status: 'online', foodLevel: 72 });
    expect(parseStatus({ deviceId: 'f1', kennelId: 'home', timestamp: 1, status: 'weird' })).toBeNull();
    expect(isEnvelope({ deviceId: 'a', kennelId: 'b', timestamp: 1 })).toBe(true);
    expect(isEnvelope({ deviceId: 'a' })).toBe(false);
  });

  it('parseCommand rejects non-envelopes and missing command', () => {
    expect(parseCommand({ deviceId: 'a', kennelId: 'b', timestamp: 1, command: 'feed' })).not.toBeNull();
    expect(parseCommand({ deviceId: 'a', kennelId: 'b', timestamp: 1 })).toBeNull();
    expect(parseCommand('nope')).toBeNull();
  });

  it('toMs normalises seconds / ms / iso', () => {
    expect(toMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toMs('2026-01-01T00:00:00Z')).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(toMs(null)).toBeNull();
  });

  it('commandId is unique-ish', () => {
    const a = commandId(); const b = commandId();
    expect(a).not.toBe(b);
  });
});

describe('CommandRouter', () => {
  it('routes a command to a type-scoped handler and publishes an ok ack', async () => {
    const published: Array<{ topic: string; payload: any }> = [];
    const router = new CommandRouter((topic, payload) => { published.push({ topic, payload }); });
    let got: any = null;
    router.onCommand('feeder', 'feed', (cmd) => { got = cmd; });

    const cmd = buildFeed('feeder-01', 'home', 25);
    const ack = await router.handle('kennel/home/feeder/feeder-01/command', JSON.stringify(cmd));

    expect(got.params.amount).toBe(25);
    expect(ack).toMatchObject({ result: 'ok', command: 'feed', ackId: cmd.id });
    expect(published[0].topic).toBe('kennel/home/feeder/feeder-01/ack');
  });

  it('falls back to a wildcard handler and reports errors as an ack', async () => {
    const router = new CommandRouter(() => {});
    router.onCommand('restart', () => { throw new Error('boom'); });
    const ack = await router.handle(
      'kennel/home/water/w1/command',
      JSON.stringify({ deviceId: 'w1', kennelId: 'home', timestamp: 1, command: 'restart', id: 'x1' })
    );
    expect(ack).toMatchObject({ result: 'error', detail: 'boom', ackId: 'x1' });
  });

  it('rejects unknown commands', async () => {
    const router = new CommandRouter(() => {});
    const ack = await router.handle(
      'kennel/home/feeder/f1/command',
      JSON.stringify({ deviceId: 'f1', kennelId: 'home', timestamp: 1, command: 'launch', id: 'z' })
    );
    expect(ack?.result).toBe('rejected');
  });

  it('dispatches non-command leaves to onLeaf handlers', async () => {
    const router = new CommandRouter();
    const seen: string[] = [];
    router.onLeaf('kennel/+/+/+/event', (_p, ctx) => { seen.push(ctx.deviceId); });
    await router.handle('kennel/home/feeder/f1/event', JSON.stringify({ deviceId: 'f1', kennelId: 'home', timestamp: 1, event: 'jam' }));
    expect(seen).toEqual(['f1']);
  });

  it('ignores non-scheme topics', async () => {
    const router = new CommandRouter(() => {});
    expect(await router.handle('dogs/c1/location', '{}')).toBeNull();
  });

  it('derives its own subscription list', () => {
    const router = new CommandRouter();
    router.onCommand('feeder', 'feed', () => {});
    router.onCommand('door', 'door', () => {});
    router.onLeaf('kennel/+/gps/+/location', () => {});
    const subs = router.subscriptions().sort();
    expect(subs).toContain('kennel/+/feeder/+/command');
    expect(subs).toContain('kennel/+/door/+/command');
    expect(subs).toContain('kennel/+/gps/+/location');
  });
});
