export type ChatMessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  userId: string;
  challengeId: string | null;
  role: ChatMessageRole;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
