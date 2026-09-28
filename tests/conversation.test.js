import { describe, expect, it } from 'test-anywhere';
import {
  appendMessage,
  createConversation,
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

const codexLines = [
  { type: 'session_meta', payload: { id: 'codex-session', cwd: '/work' } },
  {
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Find the bug' }],
    },
  },
  {
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'shell',
      arguments: '{"command":"pwd"}',
      call_id: 'call-1',
    },
  },
  {
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      call_id: 'call-1',
      output: '/work',
    },
  },
  {
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Fixed it' }],
    },
  },
];

const claudeLines = [
  {
    type: 'user',
    uuid: 'user-1',
    parentUuid: null,
    sessionId: 'claude-session',
    message: { role: 'user', content: 'Find the bug' },
  },
  {
    type: 'assistant',
    uuid: 'assistant-1',
    parentUuid: 'user-1',
    sessionId: 'claude-session',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call-1', name: 'shell', input: {} }],
    },
  },
  {
    type: 'user',
    uuid: 'tool-1',
    parentUuid: 'assistant-1',
    sessionId: 'claude-session',
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call-1', content: '/work' },
      ],
    },
  },
  {
    type: 'assistant',
    uuid: 'assistant-2',
    parentUuid: 'tool-1',
    sessionId: 'claude-session',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Fixed it' }],
    },
  },
];

const jsonl = (lines) =>
  `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;

describe('portable conversation graph', () => {
  it('imports Codex messages and tool calls without losing native records', () => {
    const graph = importJsonl(jsonl(codexLines), 'codex');
    expect(validateConversation(graph)).toBe(true);
    expect(messages(graph).map((node) => node.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(messages(graph)[1].content[0].type).toBe('tool_call');
    expect(messages(graph)[2].content[0].type).toBe('tool_result');
    const replies = graph.links.filter((link) => link.type === 'reply_to');
    expect(replies.length).toBe(messages(graph).length - 1);
    expect(replies[0].source).toBe(messages(graph)[0].id);
    expect(replies[0].target).toBe(messages(graph)[1].id);
    expect(records(graph).map((node) => node.original)).toEqual(codexLines);
    expect(exportJsonl(graph, 'codex')).toBe(jsonl(codexLines));
  });

  it('preserves Claude Code branches, content blocks, and native records', () => {
    const graph = importJsonl(jsonl(claudeLines), 'claude');
    expect(validateConversation(graph)).toBe(true);
    expect(messages(graph).map((node) => node.content[0].type)).toEqual([
      'text',
      'tool_call',
      'tool_result',
      'text',
    ]);
    const reply = graph.links.find((link) => link.type === 'reply_to');
    expect(reply.source).toBe(messages(graph)[0].id);
    expect(reply.target).toBe(messages(graph)[1].id);
    expect(exportJsonl(graph, 'claude')).toBe(jsonl(claudeLines));
  });

  it('round trips the same graph through readable notation and binary links', () => {
    const graph = importJsonl(jsonl(claudeLines), 'claude');
    expect(decodeLino(encodeLino(graph))).toEqual(graph);
    expect(decodeBinary(encodeBinary(graph))).toEqual(graph);
    expect(encodeLino(graph)).toContain('Find the bug');
  });

  it('can build a branched conversation and export it to either agent format', () => {
    const graph = createConversation('conversation-1');
    const root = appendMessage(graph, { role: 'user', content: 'Hello' });
    appendMessage(graph, {
      role: 'assistant',
      content: 'One',
      parentId: root.id,
    });
    appendMessage(graph, {
      role: 'assistant',
      content: 'Two',
      parentId: root.id,
    });
    expect(validateConversation(graph)).toBe(true);
    expect(graph.links.filter((link) => link.type === 'reply_to').length).toBe(
      2
    );
    expect(exportJsonl(graph, 'codex')).toContain('output_text');
    expect(exportJsonl(graph, 'claude')).toContain('parentUuid');
  });

  it('keeps original records when appending a new message to an imported session', () => {
    const graph = importJsonl(jsonl(codexLines), 'codex');
    appendMessage(graph, { role: 'user', content: 'Continue' });
    const exported = exportJsonl(graph, 'codex')
      .trim()
      .split('\n')
      .map(JSON.parse);
    expect(exported.slice(0, codexLines.length)).toEqual(codexLines);
    expect(exported.at(-1).payload.content[0].text).toBe('Continue');
  });

  it('does not mutate a graph when an appended parent is invalid', () => {
    const graph = createConversation('conversation-1');
    const before = JSON.stringify(graph);
    expect(() =>
      appendMessage(graph, {
        role: 'assistant',
        content: 'Orphan',
        parentId: 'missing',
      })
    ).toThrow();
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('rejects malformed and disconnected graph data', () => {
    expect(() => importJsonl('{bad json}', 'claude')).toThrow();
    const graph = createConversation('conversation-1');
    graph.links.push({
      source: 'missing',
      type: 'contains',
      target: 'missing',
    });
    expect(() => validateConversation(graph)).toThrow();
    expect(() => decodeBinary(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it('reports the physical line number of malformed JSONL', () => {
    let error;
    try {
      importJsonl('\n{bad json}', 'codex');
    } catch (caught) {
      error = caught;
    }
    expect(error.message.includes('line 2')).toBe(true);
  });

  it('rejects reply links that point backward in record order', () => {
    const graph = createConversation('conversation-1');
    const first = appendMessage(graph, { role: 'user', content: 'First' });
    const second = appendMessage(graph, {
      role: 'assistant',
      content: 'Second',
    });
    graph.links.push({ source: second.id, type: 'reply_to', target: first.id });
    expect(() => validateConversation(graph)).toThrow();
  });
});
