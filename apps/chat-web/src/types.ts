export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  status?: MessageStatus;
  timestamp?: string;
}

export type StepState = 'pending' | 'running' | 'succeeded' | 'failed' | 'paused' | 'skipped' | 'unknown';

export interface PlanStep {
  id: string;
  tool: string;
  description: string;
  args: Record<string, unknown>;
  dependsOn?: string[];
}

export interface ActivePlan {
  id?: string;
  kind?: 'plan';
  summary: string;
  steps: PlanStep[];
  thinking?: string;
  warnings?: string[];
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ServiceConfig {
  name: string;
  title: string;
  connected: boolean;
  allowedScope?: string[];
}
