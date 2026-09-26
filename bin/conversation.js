#!/usr/bin/env node

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import {
  decodeBinary,
  decodeLino,
  encodeBinary,
  encodeLino,
  exportJsonl,
  importJsonl,
  messages,
  records,
  validateConversation,
} from '../src/conversation.js';

function usage() {
  return [
    'Usage:',
    '  conversation import <codex|claude> <session.jsonl> <archive.lino|archive.json|archive.bin>',
    '  conversation export <codex|claude> <archive> <session.jsonl>',
    '  conversation convert <codex|claude> <codex|claude> <input.jsonl> <output.jsonl>',
    '  conversation inspect <archive>',
    '',
    'Add --force to replace an existing output file.',
  ].join('\n');
}

function readGraph(path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.bin') {
    return decodeBinary(readFileSync(path));
  }
  if (extension === '.lino') {
    return decodeLino(readFileSync(path, 'utf8'));
  }
  if (extension === '.json') {
    const graph = JSON.parse(readFileSync(path, 'utf8'));
    validateConversation(graph);
    return graph;
  }
  throw new Error(`Unsupported archive extension: ${extension}`);
}

function archiveBytes(graph, path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.bin') {
    return encodeBinary(graph);
  }
  if (extension === '.lino') {
    return `${encodeLino(graph)}\n`;
  }
  if (extension === '.json') {
    return `${JSON.stringify(graph, null, 2)}\n`;
  }
  throw new Error(`Unsupported archive extension: ${extension}`);
}

function writeOutput(path, data, force) {
  writeFileSync(path, data, { flag: force ? 'w' : 'wx' });
}

function executeCommand(args, force, stdout) {
  const [command, first, second, third, fourth] = args;
  if (command === 'import' && args.length === 4) {
    const graph = importJsonl(readFileSync(second, 'utf8'), first);
    writeOutput(third, archiveBytes(graph, third), force);
    return true;
  }
  if (command === 'export' && args.length === 4) {
    writeOutput(third, exportJsonl(readGraph(second), first), force);
    return true;
  }
  if (command === 'convert' && args.length === 5) {
    const graph = importJsonl(readFileSync(third, 'utf8'), first);
    writeOutput(fourth, exportJsonl(graph, second), force);
    return true;
  }
  if (command === 'inspect' && args.length === 2) {
    const graph = readGraph(first);
    stdout(
      JSON.stringify({
        id: graph.nodes.find((node) => node.type === 'conversation').id,
        records: records(graph).length,
        messages: messages(graph).length,
      })
    );
    return true;
  }
  return false;
}

export function runCli(
  argv,
  { stdout = console.log, stderr = console.error } = {}
) {
  try {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
      stdout(usage());
      return 0;
    }
    if (argv[0] === '--version' || argv[0] === '-v') {
      const packageJson = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8')
      );
      stdout(packageJson.version);
      return 0;
    }
    const force = argv.at(-1) === '--force';
    const args = force ? argv.slice(0, -1) : argv;
    if (executeCommand(args, force, stdout)) {
      return 0;
    }
    stderr(usage());
    return 1;
  } catch (error) {
    stderr(error.message);
    return 1;
  }
}

function isCliEntryPoint() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isCliEntryPoint()) {
  process.exitCode = runCli(process.argv.slice(2));
}
