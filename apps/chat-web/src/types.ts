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
  title?: string | null;
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
  role?: 'member' | 'admin';
  status?: 'pending' | 'active' | 'disabled';
  emailVerified?: boolean;
  hasPassword?: boolean;
  hasGoogle?: boolean;
}

export interface AdminUser extends User {
  role: 'member' | 'admin'; status: 'pending' | 'active' | 'disabled';
  emailVerified: boolean; hasPassword: boolean; hasGoogle: boolean;
  createdAt: string; openSessions: number;
}
export interface AdminUserPage { users: AdminUser[]; total: number; pendingCount: number; page: number; limit: number }

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
  configured?: boolean;
  tools?: string[];
  connectionStatus?: 'healthy' | 'unhealthy' | 'unconfigured' | 'unchecked';
  lastCheckedAt?: string | null;
  allowedScope?: string[];
  credentialFields?: Array<{ key: string; label: string; type?: 'text' | 'password' }>;
  scopeKey?: string;
  scopeLabel?: string;
}
