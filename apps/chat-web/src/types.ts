import type { AnswerLookup, ScheduleResponse, ScheduleView, ScheduleProposalMetadata, SlackPlanBindings } from '@wap/tool-schemas';
export type MessageRole = 'user' | 'assistant' | 'system';
export interface AuthMessageResponse { message: string }
export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  status?: MessageStatus;
  timestamp?: string;
  created_at?: string;
  metadata?: { type?: string; planId?: string; plan?: ActivePlan; resourceLabels?: Record<string, string>; requestId?: string; replyToMessageId?: string;
    reason?: string; suggestion?: string; unavailableServices?: Array<{ id: string; name: string }>;
    options?: string[]; context?: string; lookups?: AnswerLookup[]; usedDirectory?: string[];
    proposal?: ScheduleResponse; schedule?: ScheduleView; previous?: ScheduleProposalMetadata['previous']; services?: string[]; nextRuns?: string[];
    scheduleId?: string | null; baseVersion?: number | null; runId?: string; name?: string; dueAt?: string; trigger?: string };
}

export type StepState = 'pending' | 'running' | 'succeeded' | 'failed' | 'paused' | 'skipped' | 'unknown';

export interface PlanStep {
  id: string;
  tool: string;
  description: string;
  args: Record<string, unknown>;
  dependsOn?: string[];
}

export type PersonalStatus = 'not_connected' | 'scope_required' | 'connected' | 'reconnect_required';

export interface PersonalCalendarSummary {
  id: string;
  summary: string;
  timeZone?: string;
  primary?: boolean;
  accessRole?: 'owner' | 'writer';
}

export interface PersonalSpreadsheetItem {
  id: string;
  title: string;
  canEdit: boolean;
}

export type MySheetsPickerSession =
  | { mode: 'google'; accessToken: string; expiresAt: string; developerKey: string; appId: string }
  | { mode: 'fake'; accessToken: string; expiresAt: string; fakePickerBaseUrl: string };

export interface ActivePlan {
  connections?: {
    myslack?: SlackPlanBindings;
    gmail?: { credentialId: string; email: string };
    mycalendar?: {
      credentialId: string;
      email: string;
      allowedCalendars: string[] | PersonalCalendarSummary[];
    };
    mysheets?: {
      credentialId: string;
      email: string;
      allowedSpreadsheets: string[] | PersonalSpreadsheetItem[];
    };
  };
  resourceLabels?: Record<string, string>;
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

export interface AccountProfile {
  id: string; email: string; name: string; role: 'member' | 'admin'; createdAt: string;
  hasPassword: boolean; hasGoogle: boolean; googleEmail: string | null;
}
export interface AccountSession { id: string; device: string; createdAt: string; lastUsedAt: string; current: boolean }

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
  recoveryActions: Array<'retry' | 'skip' | 'stop' | 'continue'|'slack-reconcile'>;
}

export interface ClarificationState {
  question: string;
  options: string[];
  context?: string;
  reason?: 'read_only' | 'destination';
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
  connection?: 'shared' | 'personal';
  personalStatus?: PersonalStatus;
  email?: string;
  connectedAt?: string;
  selectedCalendars?: PersonalCalendarSummary[];
  selectedSpreadsheets?: PersonalSpreadsheetItem[];
  statusReason?: string;
  id: string;
  name: string;
  connected: boolean;
  configured?: boolean;
  tools?: string[];
  connectionStatus?: 'healthy' | 'unhealthy' | 'unconfigured' | 'unchecked';
  lastCheckedAt?: string | null;
  allowedScope?: string[];
  credentialFields?: Array<{ key: string; label: string; type?: 'text' | 'password' | 'multiline'; pattern?: string }>;
  scopeKey?: string;
  scopeLabel?: string;
}

export type ServiceStatus = ServiceInfo;
