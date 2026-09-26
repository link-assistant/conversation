import { decode, encode } from 'lino-objects-codec';
import { TextDecoder, TextEncoder } from 'node:util';

const SCHEMA = 'link-assistant-conversation/v1';
const MAGIC = 'LACB0001';
const RELATIONS = ['contains', 'precedes', 'reply_to'];
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function root(graph) {
  return graph.nodes.find((node) => node.type === 'conversation');
}

export function createConversation(id, sourceFormat) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Conversation id must be a nonempty string');
  }
  const conversation = { id, type: 'conversation' };
  if (sourceFormat) {
    conversation.sourceFormat = sourceFormat;
  }
  return { schema: SCHEMA, nodes: [conversation], links: [] };
}

function orderedRecords(graph) {
  const conversation = root(graph);
  const members = new Map(
    graph.links
      .filter((link) => link.type === 'contains')
      .map((link) => [
        link.target,
        graph.nodes.find((node) => node.id === link.target),
      ])
  );
  if (members.size === 0) {
    return [];
  }
  const next = new Map(
    graph.links
      .filter((link) => link.type === 'precedes')
      .map((link) => [link.source, link.target])
  );
  const targets = new Set(next.values());
  const first = [...members.keys()].find((id) => !targets.has(id));
  const result = [];
  let id = first;
  while (id !== undefined) {
    result.push(members.get(id));
    id = next.get(id);
  }
  if (!conversation || result.length !== members.size) {
    throw new Error('Conversation record order is disconnected');
  }
  return result;
}

function validateNodes(nodes) {
  const ids = new Map();
  let roots = 0;
  for (const node of nodes) {
    if (!isObject(node) || typeof node.id !== 'string' || !node.id) {
      throw new Error('Every node needs a nonempty id');
    }
    if (ids.has(node.id)) {
      throw new Error(`Duplicate node id: ${node.id}`);
    }
    ids.set(node.id, node);
    if (node.type === 'conversation') {
      roots++;
    } else if (node.type !== 'message' && node.type !== 'event') {
      throw new Error(`Unknown node type: ${node.type}`);
    }
  }
  if (roots !== 1) {
    throw new Error('Conversation needs exactly one root node');
  }
  return ids;
}

function validateContainsLink(link, conversation, contains) {
  if (link.source !== conversation.id || link.target === conversation.id) {
    throw new Error('A contains link must point from the root to a record');
  }
  if (contains.has(link.target)) {
    throw new Error('Duplicate contains link');
  }
  contains.add(link.target);
}

function validatePrecedesLink(link, preceding, following) {
  if (preceding.has(link.source) || following.has(link.target)) {
    throw new Error('Record order must form one chain');
  }
  preceding.add(link.source);
  following.add(link.target);
}

function validateLinks(graph, ids) {
  const conversation = root(graph);
  const contains = new Set();
  const preceding = new Set();
  const following = new Set();
  const replies = [];
  for (const link of graph.links) {
    if (
      !isObject(link) ||
      !ids.has(link.source) ||
      !ids.has(link.target) ||
      !RELATIONS.includes(link.type)
    ) {
      throw new Error('Invalid link or missing link endpoint');
    }
    if (link.type === 'contains') {
      validateContainsLink(link, conversation, contains);
    } else if (link.type === 'precedes') {
      validatePrecedesLink(link, preceding, following);
    } else if (link.type === 'reply_to') {
      const parent = ids.get(link.source);
      const child = ids.get(link.target);
      if (parent.type !== 'message' || child.type !== 'message') {
        throw new Error('Reply links must connect messages');
      }
      replies.push(link);
    }
  }
  if (contains.size !== graph.nodes.length - 1) {
    throw new Error('Every record must be linked to the conversation');
  }
  if (preceding.size !== Math.max(0, contains.size - 1)) {
    throw new Error('Record order must form one chain');
  }
  return replies;
}

function validateReplyOrder(graph, replies) {
  const positions = new Map(
    orderedRecords(graph).map((node, index) => [node.id, index])
  );
  const replyChildren = new Set();
  for (const reply of replies) {
    if (
      positions.get(reply.source) >= positions.get(reply.target) ||
      replyChildren.has(reply.target)
    ) {
      throw new Error('Reply links need an earlier, unique parent');
    }
    replyChildren.add(reply.target);
  }
}

export function validateConversation(graph) {
  if (!isObject(graph) || graph.schema !== SCHEMA) {
    throw new Error(`Expected ${SCHEMA}`);
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    throw new Error('Conversation nodes and links must be arrays');
  }
  const ids = validateNodes(graph.nodes);
  const replies = validateLinks(graph, ids);
  validateReplyOrder(graph, replies);
  return true;
}

export function records(graph) {
  validateConversation(graph);
  return orderedRecords(graph);
}

export function messages(graph) {
  return records(graph).filter((node) => node.type === 'message');
}

function appendNode(graph, node, parentId) {
  validateConversation(graph);
  if (graph.nodes.some((existing) => existing.id === node.id)) {
    throw new Error(`Duplicate node id: ${node.id}`);
  }
  if (parentId !== undefined && parentId !== null) {
    if (
      !graph.nodes.some(
        (item) => item.id === parentId && item.type === 'message'
      )
    ) {
      throw new Error(`Unknown parent message: ${parentId}`);
    }
  }
  const existing = orderedRecords(graph);
  graph.nodes.push(node);
  graph.links.push({
    source: root(graph).id,
    type: 'contains',
    target: node.id,
  });
  if (existing.length > 0) {
    graph.links.push({
      source: existing.at(-1).id,
      type: 'precedes',
      target: node.id,
    });
  }
  if (parentId !== undefined && parentId !== null) {
    graph.links.push({ source: parentId, type: 'reply_to', target: node.id });
  }
  validateConversation(graph);
  return node;
}

function contentBlocks(content) {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (!Array.isArray(content) || !content.every(isObject)) {
    throw new Error('Message content must be text or an array of blocks');
  }
  return content;
}

export function appendMessage(graph, { id, role, content, parentId } = {}) {
  if (!['system', 'developer', 'user', 'assistant', 'tool'].includes(role)) {
    throw new Error(`Unsupported message role: ${role}`);
  }
  const node = {
    id: id ?? `record:${graph.nodes.length}`,
    type: 'message',
    role,
    content: contentBlocks(content),
  };
  return appendNode(graph, node, parentId);
}

function codexMessage(record) {
  if (record.type !== 'response_item') {
    return null;
  }
  const payload = record.payload;
  if (!isObject(payload)) {
    return null;
  }
  if (payload.type === 'message') {
    const content = Array.isArray(payload.content) ? payload.content : [];
    return {
      role: payload.role,
      content: content.map((block) =>
        typeof block.text === 'string'
          ? { type: 'text', text: block.text }
          : { type: 'native', value: block }
      ),
    };
  }
  if (payload.type === 'function_call') {
    return {
      role: 'assistant',
      content: [
        {
          type: 'tool_call',
          name: payload.name,
          arguments: payload.arguments,
          callId: payload.call_id,
        },
      ],
    };
  }
  if (payload.type === 'function_call_output') {
    return {
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          callId: payload.call_id,
          content: payload.output,
        },
      ],
    };
  }
  return null;
}

function claudeMessage(record) {
  if (
    !['user', 'assistant'].includes(record.type) ||
    !isObject(record.message)
  ) {
    return null;
  }
  const blocks = contentBlocks(record.message.content ?? []);
  const content = blocks.map((block) => {
    if (block.type === 'tool_use') {
      return {
        type: 'tool_call',
        name: block.name,
        arguments: block.input,
        callId: block.id,
      };
    }
    if (block.type === 'tool_result') {
      return {
        type: 'tool_result',
        callId: block.tool_use_id,
        content: block.content,
      };
    }
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
    return { type: 'native', value: block };
  });
  return {
    role:
      content.length > 0 &&
      content.every((block) => block.type === 'tool_result')
        ? 'tool'
        : record.message.role,
    content,
  };
}

function parseJsonl(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  return lines.map((line, index) => {
    try {
      const record = JSON.parse(line);
      if (!isObject(record)) {
        throw new Error('Expected a JSON object');
      }
      return record;
    } catch (error) {
      throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
    }
  });
}

function conversationId(parsed, format) {
  return (
    (format === 'codex'
      ? parsed.find((record) => record.type === 'session_meta')?.payload?.id
      : parsed.find((record) => record.sessionId)?.sessionId) ?? 'conversation'
  );
}

function importRecords(graph, parsed, format) {
  const nativeIds = new Map();
  const pendingParents = [];
  let previousCodexMessage;
  for (const original of parsed) {
    const normalized =
      format === 'codex' ? codexMessage(original) : claudeMessage(original);
    const node = {
      id: `record:${graph.nodes.length}`,
      type: normalized ? 'message' : 'event',
      ...(normalized ?? {}),
      nativeFormat: format,
      original,
    };
    appendNode(
      graph,
      node,
      format === 'codex' && normalized ? previousCodexMessage : undefined
    );
    if (format === 'codex' && normalized) {
      previousCodexMessage = node.id;
    }
    if (format === 'claude' && normalized) {
      if (typeof original.uuid === 'string' && !nativeIds.has(original.uuid)) {
        nativeIds.set(original.uuid, node.id);
      }
      if (typeof original.parentUuid === 'string') {
        pendingParents.push([node.id, original.parentUuid]);
      }
    }
  }
  return { nativeIds, pendingParents };
}

export function importJsonl(text, format) {
  if (!['codex', 'claude'].includes(format)) {
    throw new Error(`Unsupported source format: ${format}`);
  }
  if (typeof text !== 'string') {
    throw new Error('JSONL input must be text');
  }
  const parsed = parseJsonl(text);
  const graph = createConversation(conversationId(parsed, format), format);
  const { nativeIds, pendingParents } = importRecords(graph, parsed, format);
  for (const [child, nativeParent] of pendingParents) {
    const parent = nativeIds.get(nativeParent);
    if (parent && parent !== child) {
      graph.links.push({ source: parent, type: 'reply_to', target: child });
    }
  }
  validateConversation(graph);
  return graph;
}

function syntheticCodex(node) {
  const result = [];
  const text = [];
  for (const block of node.content) {
    if (block.type === 'text') {
      text.push({
        type: node.role === 'user' ? 'input_text' : 'output_text',
        text: block.text,
      });
    } else if (block.type === 'tool_call') {
      result.push({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: block.name,
          arguments:
            typeof block.arguments === 'string'
              ? block.arguments
              : JSON.stringify(block.arguments ?? {}),
          call_id: block.callId,
        },
      });
    } else if (block.type === 'tool_result') {
      result.push({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: block.callId,
          output:
            typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content),
        },
      });
    } else {
      throw new Error(`Cannot export ${block.type} content to Codex`);
    }
  }
  if (text.length > 0 || result.length === 0) {
    result.unshift({
      type: 'response_item',
      payload: { type: 'message', role: node.role, content: text },
    });
  }
  return result;
}

function syntheticClaude(node, uuid, parentUuid, sessionId) {
  const content = node.content.map((block) => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
    if (block.type === 'tool_call') {
      let input = block.arguments ?? {};
      if (typeof input === 'string') {
        try {
          input = JSON.parse(input);
        } catch {
          input = { raw: input };
        }
      }
      return { type: 'tool_use', id: block.callId, name: block.name, input };
    }
    if (block.type === 'tool_result') {
      return {
        type: 'tool_result',
        tool_use_id: block.callId,
        content: block.content,
      };
    }
    throw new Error(`Cannot export ${block.type} content to Claude Code`);
  });
  const role = node.role === 'tool' ? 'user' : node.role;
  if (!['user', 'assistant'].includes(role)) {
    throw new Error(`Cannot export ${role} role to Claude Code`);
  }
  return {
    type: role,
    uuid,
    parentUuid,
    sessionId,
    message: { role, content },
  };
}

function exportRecords(graph, ordered, format, sessionId) {
  const output = [];
  const uuids = new Map();
  const parents = new Map(
    graph.links
      .filter((link) => link.type === 'reply_to')
      .map((link) => [link.target, link.source])
  );
  for (const node of ordered) {
    if (node.nativeFormat === format && node.original) {
      output.push(node.original);
      if (
        format === 'claude' &&
        node.type === 'message' &&
        node.original.uuid
      ) {
        uuids.set(node.id, node.original.uuid);
      }
      continue;
    }
    if (node.type !== 'message') {
      continue;
    }
    if (format === 'codex') {
      output.push(...syntheticCodex(node));
    } else {
      const uuid = globalThis.crypto.randomUUID();
      uuids.set(node.id, uuid);
      output.push(
        syntheticClaude(
          node,
          uuid,
          uuids.get(parents.get(node.id)) ?? null,
          sessionId
        )
      );
    }
  }
  return output;
}

export function exportJsonl(graph, format) {
  if (!['codex', 'claude'].includes(format)) {
    throw new Error(`Unsupported target format: ${format}`);
  }
  const ordered = records(graph);
  const sessionId =
    ordered.find(
      (node) => node.nativeFormat === 'claude' && node.original?.sessionId
    )?.original.sessionId ?? globalThis.crypto.randomUUID();
  const hasSessionMeta = ordered.some(
    (node) =>
      node.nativeFormat === 'codex' && node.original?.type === 'session_meta'
  );
  const output = exportRecords(graph, ordered, format, sessionId);
  if (format === 'codex' && !hasSessionMeta) {
    output.unshift({ type: 'session_meta', payload: { id: sessionId } });
  }
  return output.length > 0
    ? `${output.map((line) => JSON.stringify(line)).join('\n')}\n`
    : '';
}

export function encodeLino(graph) {
  validateConversation(graph);
  return encode({ obj: graph });
}

export function decodeLino(text) {
  const graph = decode({ notation: text });
  validateConversation(graph);
  return graph;
}

export function encodeBinary(graph) {
  validateConversation(graph);
  const nodes = graph.nodes.map((node) => encoder.encode(JSON.stringify(node)));
  const indexes = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const length =
    16 +
    nodes.reduce((sum, node) => sum + 4 + node.length, 0) +
    graph.links.length * 9;
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  bytes.set(encoder.encode(MAGIC));
  view.setUint32(8, nodes.length, true);
  view.setUint32(12, graph.links.length, true);
  let offset = 16;
  for (const node of nodes) {
    view.setUint32(offset, node.length, true);
    offset += 4;
    bytes.set(node, offset);
    offset += node.length;
  }
  for (const link of graph.links) {
    view.setUint32(offset, indexes.get(link.source), true);
    bytes[offset + 4] = RELATIONS.indexOf(link.type) + 1;
    view.setUint32(offset + 5, indexes.get(link.target), true);
    offset += 9;
  }
  return bytes;
}

export function decodeBinary(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 16 || decoder.decode(bytes.subarray(0, 8)) !== MAGIC) {
    throw new Error('Invalid conversation binary header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nodeCount = view.getUint32(8, true);
  const linkCount = view.getUint32(12, true);
  if (
    nodeCount > Math.floor((bytes.length - 16) / 4) ||
    linkCount > Math.floor(bytes.length / 9)
  ) {
    throw new Error('Invalid conversation binary counts');
  }
  const nodes = [];
  let offset = 16;
  for (let index = 0; index < nodeCount; index++) {
    if (offset + 4 > bytes.length) {
      throw new Error('Truncated binary node');
    }
    const size = view.getUint32(offset, true);
    offset += 4;
    if (offset + size > bytes.length) {
      throw new Error('Truncated binary node');
    }
    nodes.push(
      JSON.parse(decoder.decode(bytes.subarray(offset, offset + size)))
    );
    offset += size;
  }
  const links = [];
  for (let index = 0; index < linkCount; index++) {
    if (offset + 9 > bytes.length) {
      throw new Error('Truncated binary link');
    }
    const source = nodes[view.getUint32(offset, true)]?.id;
    const type = RELATIONS[bytes[offset + 4] - 1];
    const target = nodes[view.getUint32(offset + 5, true)]?.id;
    links.push({ source, type, target });
    offset += 9;
  }
  if (offset !== bytes.length) {
    throw new Error('Trailing data in binary conversation');
  }
  const graph = { schema: SCHEMA, nodes, links };
  validateConversation(graph);
  return graph;
}
