import type { Citation } from "./citation";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly text: string;
  readonly createdAt: string;
  readonly citations: readonly Citation[];
}

export interface ChatSession {
  readonly id: string;
  readonly paperId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly ChatMessage[];
}

export function createChatSession(input: {
  readonly id: string;
  readonly paperId: string;
  readonly title: string;
  readonly now: string;
}): ChatSession {
  return {
    id: input.id,
    paperId: input.paperId,
    title: input.title,
    createdAt: input.now,
    updatedAt: input.now,
    messages: [],
  };
}

export function appendChatMessage(session: ChatSession, message: ChatMessage): ChatSession {
  return {
    ...session,
    updatedAt: message.createdAt,
    messages: [...session.messages, message],
  };
}

export function replaceChatMessage(session: ChatSession, messageId: string, patch: Partial<ChatMessage>): ChatSession {
  let changed = false;
  const messages = session.messages.map((message) => {
    if (message.id !== messageId) return message;
    changed = true;
    return { ...message, ...patch };
  });
  if (!changed) return session;
  return { ...session, updatedAt: new Date().toISOString(), messages };
}

const TITLE_LIMIT = 40;

export function sessionTitleFromQuestion(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length === 0) return "新会话";
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT)}…` : line;
}
