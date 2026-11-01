import type { AnswerLookup, CalendarDigestDelivery, ScheduleResponse, ScheduleView, ScheduleProposalMetadata } from '@wap/tool-schemas';
export type MessageRole = 'user' | 'assistant' | 'system';
export interface AuthMessageResponse {
  message: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  user?: User;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: 'admin' | 'member';
  status: 'pending' | 'active' | 'disabled';
  inviteCode?: string;
  requireApproval?: boolean;
  pendingCount?: number;
  createdAt?: string;
}

export interface WorkspacesListResponse {
  personal: WorkspaceSummary;
  organizations: WorkspaceSummary[];
}
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
    digestCandidate?: ScheduleProposalMetadata['digestCandidate']; delivery?: CalendarDigestDelivery;
    scheduleId?: string | null; baseVersion?: number | null; runId?: string; name?: string; dueAt?: string; trigger?: string };
}

export type StepState = 'pending' | 'running' | 'succeeded' | 'failed' | 'paused' | 'skipped' | 'unknown';

export interface PlanStep {
  id: string;
  tool: string;
  description: string;
  args: Record<string, unknown>;
  chatId?: string;
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
  sheets?: string[];
}

export type MySheetsPickerSession =
  | { mode: 'google'; accessToken: string; expiresAt: string; developerKey: string; appId: string }
  | { mode: 'fake'; accessToken: string; expiresAt: string; fakePickerBaseUrl: string };

export interface ActivePlan {
  connections?: {
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
    trello?: {
      credentialId: string;
      memberId: string;
      username: string;
      boardIds: string[];
    };
    github?: {
      credentialId: string;
      githubUserId: string;
      login: string;
      repos: string[];
    };
    telegram?: {
      credentialId: string;
      telegramUserId: string;
      username: string;
      chatIds: string[];
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
export interface AdminUserPage {
  users: AdminUser[];
  total: number;
  pendingCount: number;
  page: number;
  limit: number;
  inviteCode?: string;
  requireApproval?: boolean;
  workspaceName?: string;
}

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
  recoveryActions: Array<'retry' | 'skip' | 'stop' | 'continue'>;
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
  username?: string;
  login?: string;
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
