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
  title?: string;
  updatedAt?: string;
  updated_at?: string;
  created_at?: string;
  status?: string;
  user_id?: string;
}

export interface ServiceConfig {
  name: string;
  title: string;
  connected: boolean;
  allowedScope?: string[];
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export type PlanStatus = 'idle' | 'preview' | 'approving' | 'executing' | 'completed' | 'rejected';

export interface ClarificationState {
  question: string;
  options: string[];
  context?: string;
}

export interface GatherStep {
  tool: string;
  result?: string;
  status: 'running' | 'completed';
}

export interface GatherState {
  isGathering: boolean;
  steps: GatherStep[];
  summary: string;
}

export interface ServiceInfo {
  id: string;
  name: string;
  connected: boolean;
  allowedScope?: string[];
  credentialFields?: Array<{ key: string; label: string; type?: 'text' | 'password' }>;
  scopeKey?: string;
  scopeLabel?: string;
}
