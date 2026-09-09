import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser } from '@asyncapi/parser';

const spec = readFileSync(fileURLToPath(new URL('../asyncapi.yaml', import.meta.url)), 'utf8');

describe('asyncapi.yaml', () => {
  it('parses with no diagnostics errors and matches package.json version', async () => {
    const { document, diagnostics } = await new Parser().parse(spec);
    const errors = diagnostics.filter((d) => d.severity === 0);
    expect(errors).toEqual([]);
    expect(document).toBeDefined();
    expect(document!.info().version()).toBe(require('../package.json').version);
  });

  it('covers every protocol-v2 leaf channel', async () => {
    const { document } = await new Parser().parse(spec);
    const ids = document!.channels().all().map((c) => c.id());
    for (const leaf of ['status', 'command', 'ack', 'event', 'telemetry', 'metric', 'location', 'presence', 'audio']) {
      expect(ids).toContain(leaf);
    }
  });
});
