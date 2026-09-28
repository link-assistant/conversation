export type AgentFormat = 'codex' | 'claude';
export type Relation = 'contains' | 'precedes' | 'reply_to';
export type Role = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export interface ContentBlock {
  type: 'text' | 'tool_call' | 'tool_result' | 'native';
  text?: string;
  name?: string;
  arguments?: unknown;
  callId?: string;
  content?: unknown;
  value?: unknown;
}

export interface ConversationNode {
  id: string;
  type: 'conversation' | 'message' | 'event';
  sourceFormat?: AgentFormat;
  role?: Role;
  content?: ContentBlock[];
  nativeFormat?: AgentFormat;
  original?: Record<string, unknown>;
}

export interface ConversationLink {
  source: string;
  type: Relation;
  target: string;
}

export interface Conversation {
  schema: 'link-assistant-conversation/v1';
  nodes: ConversationNode[];
  links: ConversationLink[];
}

export declare function createConversation(
  id: string,
  sourceFormat?: AgentFormat
): Conversation;
export declare function validateConversation(graph: Conversation): true;
export declare function records(graph: Conversation): ConversationNode[];
export declare function messages(graph: Conversation): ConversationNode[];
export declare function appendMessage(
  graph: Conversation,
  message: {
    id?: string;
    role: Role;
    content: string | ContentBlock[];
    parentId?: string;
  }
): ConversationNode;
export declare function importJsonl(
  text: string,
  format: AgentFormat
): Conversation;
export declare function exportJsonl(
  graph: Conversation,
  format: AgentFormat
): string;
export declare function encodeLino(graph: Conversation): string;
export declare function decodeLino(text: string): Conversation;
export declare function encodeBinary(graph: Conversation): Uint8Array;
export declare function decodeBinary(bytes: Uint8Array): Conversation;
