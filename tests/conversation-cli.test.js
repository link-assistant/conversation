import { describe, expect, it } from 'test-anywhere';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../bin/conversation.js';

describe('conversation CLI', () => {
  it('imports to binary and exports to another agent format', () => {
    if (typeof Deno !== 'undefined') {
      return;
    }
    const folder = mkdtempSync(join(tmpdir(), 'conversation-cli-'));
    const source = join(folder, 'source.jsonl');
    const archive = join(folder, 'archive.bin');
    const destination = join(folder, 'destination.jsonl');
    writeFileSync(
      source,
      `${JSON.stringify({
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: 's1',
        message: { role: 'user', content: 'Hello' },
      })}\n`
    );
    const stderr = [];
    try {
      expect(
        runCli(['import', 'claude', source, archive], {
          stderr: (line) => stderr.push(line),
        })
      ).toBe(0);
      expect(
        runCli(['export', 'codex', archive, destination], {
          stderr: (line) => stderr.push(line),
        })
      ).toBe(0);
      expect(readFileSync(destination, 'utf8')).toContain('Hello');
      expect(
        runCli(['export', 'codex', archive, destination], {
          stderr: (line) => stderr.push(line),
        })
      ).toBe(1);
      expect(stderr.at(-1)).toContain('exists');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
