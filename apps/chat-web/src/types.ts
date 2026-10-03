export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  status?: MessageStatus;
  timestamp?: string;
  created_at?: string;
  metadata?: { type?: string };
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
  status?: PlanStatus | 'pending' | 'approved';
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
  archived_at?: string | null;
  deleted_at?: string | null;
}

export interface ServiceConfig {
  name: string;
  title: string;
  connected: boolean;
  allowedScope?: string[];
}

export interface User {
  role?: 'member' | 'admin';
  status?: 'pending' | 'active' | 'disabled';
  isAdmin?: boolean;
  emailVerified?: boolean;
  hasPassword?: boolean;
  hasGoogle?: boolean;
  id: string;
  email: string;
  name: string;
}

export type PlanStatus = 'idle' | 'preview' | 'approving' | 'executing' | 'completed' | 'rejected' | 'partial' | 'reconciliation_required' | 'stopped' | 'failed';

export interface ExecutionSnapshot {
  plan: Omit<Partial<ActivePlan>, 'status'> & { id: string; convId: string; status: string };
  execution: { status: PlanStatus; pausedStepId?: string };
  steps: Array<{
    stepId: string;
    tool: string;
    status: StepState;
    output?: unknown;
    error?: { message?: string } | string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    durationMs?: number | null;
  }>;
  recoveryActions: Array<'retry' | 'skip' | 'stop' | 'continue'>;
}

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
