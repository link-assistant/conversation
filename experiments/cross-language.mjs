import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const rust = join(root, 'rust/target/debug/link-assistant-conversation');
const js = join(root, 'bin/conversation.js');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr}`);
  }
}

run('cargo', ['build', '--manifest-path', 'rust/Cargo.toml']);
const folder = mkdtempSync(join(tmpdir(), 'conversation-cross-'));
try {
  const source = join(folder, 'claude.jsonl');
  const lines = [
    {
      type: 'user',
      uuid: 'u1',
      parentUuid: null,
      sessionId: 's1',
      message: { role: 'user', content: 'Hello 世界' },
    },
    {
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'u1',
      sessionId: 's1',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'shell',
            input: { command: 'pwd' },
          },
        ],
      },
    },
  ];
  writeFileSync(
    source,
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`
  );
  for (const [writer, reader, suffix, format] of [
    [process.execPath, rust, 'js', 'bin'],
    [rust, process.execPath, 'rust', 'bin'],
    [process.execPath, rust, 'js', 'lino'],
    [rust, process.execPath, 'rust', 'lino'],
  ]) {
    const archive = join(folder, `${suffix}.${format}`);
    const exported = join(folder, `${suffix}-${format}.jsonl`);
    const writerArgs = writer === rust ? [] : [js];
    const readerArgs = reader === rust ? [] : [js];
    run(writer, [...writerArgs, 'import', 'claude', source, archive]);
    run(reader, [...readerArgs, 'export', 'claude', archive, exported]);
    assert.deepEqual(
      readFileSync(exported, 'utf8').trim().split('\n').map(JSON.parse),
      lines
    );
  }
  console.log('Binary and Links Notation archives pass in both directions');
} finally {
  rmSync(folder, { recursive: true, force: true });
}
