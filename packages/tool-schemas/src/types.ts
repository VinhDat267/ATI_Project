import type { JiraPlanConnection } from './myjira-context.js';
import type { ReportEvidence } from './report-evidence.js';

/**
 * Input properties naming an external resource carry `x-resource` (the working
 * memory entity key filled by gather, e.g. 'list') and optionally
 * `x-resource-field` (the entity field holding the value, default 'id').
 * The planner rejects plans whose resource values were never looked up.
 */
export type JSONSchema = Record<string, any>;

export interface ToolDefinition {
  name: string;
  service: string;
  description: string;
  sideEffect: 'read' | 'write';
  /** For a search tool: the working-memory resource its results identify, e.g. 'board'. */
  discovers?: string;
  /** The search may be called with an empty query to enumerate the resource (bounded by `limit`). */
  listable?: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  /** Overrides the planner's KEPT_FIELDS when this tool's results are written to working memory. */
  observedFields?: string[];
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  examples?: Array<{
    description?: string;
    input: Record<string, any>;
    output: Record<string, any>;
  }>;
}

export interface GatherRule {
  entityKey: string;
  tool: string;
  pattern: RegExp;
  nameField?: string;
  requires?: {
    entityKey: string;
    argument: string;
    searchTool: string;
    question: string;
    context: string;
  };
  invalidates?: string[];
}

export interface ServiceDefinition {
  id: string;
  name: string;
  description: string;
  /** Missing means 'shared': an administrator configures one key for everyone. */
  connection?: 'shared' | 'personal';
  scopes: string[];
  scopeKey: string;
  scopeLabel: string;
  scopePattern?: RegExp;
  /** Canonical resource spelling, applied after validating the supplied scope. */
  normalizeScopeEntry?: (entry: string) => string;
  credentialFields: Array<{ key: string; label: string; type: 'text' | 'password' | 'multiline'; pattern?: string }>;
  intentKeywords: string[];
  /** Phrases that select the service even when another service is named, e.g. "create a task". */
  intentPatterns?: RegExp[];
  /** Generic words used only when no other service matches, e.g. "task" in "about task X". */
  fallbackIntentKeywords?: string[];
  gatherRules?: GatherRule[];
}

export type ArgValue =
  | string
  | number
  | boolean
  | null
  | { $ref: string }
  | { $template: string }
  | ArgValue[]
  | { [key: string]: ArgValue };

export interface PlanStep {
  id: string;
  tool: string;
  description: string;
  args: Record<string, ArgValue>;
  dependsOn: string[];
  boardId?: string;
  repo?: string;
  chatId?: string;
  databaseId?: string;
}

/** The personal connections a plan was previewed with. */
export interface PlanConnections {
  myslack?: import('./myslack-plan-bindings.js').SlackPlanBindings;
  gmail?: { credentialId: string; email: string };
  mycalendar?: { credentialId: string; email: string; allowedCalendars: string[] };
  mysheets?: { credentialId: string; email: string; allowedSpreadsheets: string[] };
  trello?: { credentialId: string; memberId: string; username: string; boardIds: string[] };
  github?: { credentialId: string; githubUserId: string; login: string; repos: string[] };
  telegram?: { credentialId: string; telegramUserId: string; username: string; chatIds: string[] };
  notion?: {
    credentialId: string;
    workspaceId: string;
    workspaceName: string;
    botId: string;
    identityVersion: number;
    databaseIds: string[];
    databases?: Array<{ id: string; title: string; url?: string }>;
  };
  myjira?: JiraPlanConnection;
}

export interface PersonalCalendarItem {
  id: string;
  summary: string;
  timeZone: string;
  primary?: boolean;
}

export interface PersonalSpreadsheetItem {
  id: string;
  title: string;
  canEdit: boolean;
  sheets?: string[];
}

export interface PlanResponse {
  kind: 'plan';
  thinking: string;
  summary: string;
  steps: PlanStep[];
  warnings: string[];
  /** Written only by the server, after validation and before the plan hash is computed. */
  connections?: PlanConnections;
  /** Server-verified report evidence binding (FLOW-01, F1) */
  reportEvidence?: ReportEvidence;
}

export interface ClarificationResponse {
  kind: 'clarification';
  question: string;
  options?: string[];
  context: string;
  reason?: 'read_only' | 'destination';
}

export interface RefusalResponse {
  kind: 'refusal';
  reason: string;
  suggestion?: string;
  unavailableServices?: Array<{ id: string; name: string }>;
}

export interface AnswerLookup { tool: string; query?: string; resultCount: number; links: string[] }
export interface AnswerResponse { kind: 'answer'; text: string; lookups: AnswerLookup[]; usedDirectory: string[] }

/** ISO weekday: 1 = thứ Hai … 7 = Chủ nhật. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Dates and times are local to APP_TIME_ZONE. */
export type ScheduleRecurrence =
  | { type: 'once'; date: string; time: string }   // YYYY-MM-DD, HH:mm
  | { type: 'daily'; time: string }
  | { type: 'weekly'; time: string; days: Weekday[] }; // non-empty, unique, ascending

/** The planner returns this when the user wants to create, change, pause, resume or cancel a schedule. */
export interface ScheduleResponse {
  kind: 'schedule';
  action: 'create' | 'update' | 'pause' | 'resume' | 'cancel';
  /** Required for create/update; ignored for pause/resume/cancel. */
  name?: string;                  // 1–80 characters
  request?: string;               // 1–1000 characters, worded as if the user asked to run it now
  recurrence?: ScheduleRecurrence;
  summary: string;
}

export type PlannerResponse = PlanResponse | ClarificationResponse | RefusalResponse | AnswerResponse | ScheduleResponse;

export type ScheduleStatus = 'active' | 'paused' | 'cancelled' | 'completed';
export type ScheduleKind = 'plan' | 'plan_approval' | 'sheets_digest' | 'calendar_digest' | 'github_digest' | 'telegram_digest' | 'trello_digest' | 'notion_digest' | 'myjira_digest';
export type ScheduleApprovalMode = 'manual' | 'auto_digest';

export type SheetsDigestWorkspaceMode = 'personal' | 'organization' | 'legacy';

export type SheetsDigestDataScope =
  | 'full_tab_verified'
  | 'full_requested_range'
  | 'partial';

export interface SheetsDigestConfigV1 {
  version: 1;
  source: {
    service: 'mysheets' | 'sheets';
    credentialId?: string;
    email?: string;
    spreadsheetId: string;
    spreadsheetTitle: string;
    sheetName?: string;
    range?: string;
    tailRows: number;
  };
  destination:
    | { service: 'slack'; channelId: string; channelLabel?: string }
    | { service: 'telegram'; chatId: string; chatLabel?: string }
    | { service: 'gmail'; recipientEmail: string; credentialId?: string };
  focus?: string;
  includeAiSummary: boolean;
}

export interface SheetsDigestSourceConfigV2 {
  service: 'mysheets' | 'sheets';
  credentialId: string;
  email?: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName?: string;
  range?: string;
  tailRows: number;
}

export type SheetsDigestDestinationConfigV2 =
  | {
      service: 'slack';
      credentialId: string;
      channelId: string;
      channelLabel?: string;
    }
  | {
      service: 'telegram';
      credentialId: string;
      chatId: string;
      chatLabel?: string;
    }
  | {
      service: 'gmail';
      credentialId: string;
      senderEmail?: string;
      recipientEmail: string;
    };

export interface SheetsDigestConfigV2 {
  version: 2;
  workspaceMode: SheetsDigestWorkspaceMode;
  workspaceId: string | null;
  source: SheetsDigestSourceConfigV2;
  destination: SheetsDigestDestinationConfigV2;
  focus?: string;
  includeAiSummary: boolean;
}

export type SheetsDigestConfig = SheetsDigestConfigV1 | SheetsDigestConfigV2;

export function isSheetsDigestConfigV2(config: unknown): config is SheetsDigestConfigV2 {
  if (typeof config !== 'object' || config === null) {
    return false;
  }
  const rec = config as Record<string, unknown>;
  if (rec.version !== 2) {
    return false;
  }
  if (
    rec.workspaceMode !== 'personal' &&
    rec.workspaceMode !== 'organization' &&
    rec.workspaceMode !== 'legacy'
  ) {
    return false;
  }
  if (rec.workspaceMode === 'organization') {
    if (typeof rec.workspaceId !== 'string' || rec.workspaceId.trim().length === 0) {
      return false;
    }
  } else if (rec.workspaceId !== null) {
    return false;
  }

  if (typeof rec.source !== 'object' || rec.source === null) {
    return false;
  }
  const source = rec.source as Record<string, unknown>;
  if (source.service !== 'mysheets' && source.service !== 'sheets') {
    return false;
  }
  if (typeof source.credentialId !== 'string' || source.credentialId.trim().length === 0) {
    return false;
  }
  if (typeof source.spreadsheetId !== 'string' || source.spreadsheetId.trim().length === 0) {
    return false;
  }
  if (typeof source.spreadsheetTitle !== 'string') {
    return false;
  }
  if (
    typeof source.tailRows !== 'number' ||
    !Number.isFinite(source.tailRows) ||
    source.tailRows <= 0
  ) {
    return false;
  }
  if (source.email !== undefined && typeof source.email !== 'string') {
    return false;
  }
  if (source.sheetName !== undefined && typeof source.sheetName !== 'string') {
    return false;
  }
  if (source.range !== undefined && typeof source.range !== 'string') {
    return false;
  }

  if (typeof rec.destination !== 'object' || rec.destination === null) {
    return false;
  }
  const destination = rec.destination as Record<string, unknown>;
  if (typeof destination.credentialId !== 'string' || destination.credentialId.trim().length === 0) {
    return false;
  }
  if (destination.service === 'slack') {
    if (typeof destination.channelId !== 'string' || destination.channelId.trim().length === 0) {
      return false;
    }
    if (destination.channelLabel !== undefined && typeof destination.channelLabel !== 'string') {
      return false;
    }
  } else if (destination.service === 'telegram') {
    if (typeof destination.chatId !== 'string' || destination.chatId.trim().length === 0) {
      return false;
    }
    if (destination.chatLabel !== undefined && typeof destination.chatLabel !== 'string') {
      return false;
    }
  } else if (destination.service === 'gmail') {
    if (
      typeof destination.recipientEmail !== 'string' ||
      !destination.recipientEmail.trim().includes('@')
    ) {
      return false;
    }
    if (
      destination.senderEmail !== undefined &&
      (typeof destination.senderEmail !== 'string' || !destination.senderEmail.trim().includes('@'))
    ) {
      return false;
    }
  } else {
    return false;
  }

  if (rec.focus !== undefined && typeof rec.focus !== 'string') {
    return false;
  }
  if (typeof rec.includeAiSummary !== 'boolean') {
    return false;
  }

  return true;
}

export interface SheetsDigestPreviewInfo {
  workspaceMode: SheetsDigestWorkspaceMode;
  workspaceName?: string;
  sourceConnectionLabel: string;
  sourceOwnerLabel: string;
  spreadsheetTitle: string;
  spreadsheetId: string;
  sheetName?: string;
  range?: string;
  requestedRangeLabel: string;
  destinationConnectionLabel: string;
  destinationTargetLabel: string;
  crossBoundaryWarning?: string;
  includeAiSummary?: boolean;
}

export interface SheetsDigestCandidate {
  canAutoDigest: boolean;
  config?: SheetsDigestConfig;
  configHash?: string;
  preview?: SheetsDigestPreviewInfo;
  requiresClarification?: boolean;
  reason?: string;
}

export interface SheetsDigestManualResolution {
  status: 'confirmed_sent';
  resolvedAt: string;
  manualConfirmedAt?: string;
  resolvedBy: string;
}

export interface SheetsDigestDelivery {
  destination: 'slack' | 'telegram' | 'gmail';
  targetId: string;
  targetLabel?: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName?: string;
  rowCount: number | null;
  dataScope?: SheetsDigestDataScope;
  scannedRange?: string;
  windowClipped?: boolean;
  summaryMode: 'ai' | 'deterministic';
  sentAt: string | null;
  providerSentAt?: string | null;
  manualConfirmedAt?: string;
  slackMessageTs?: string;
  telegramMessageId?: string | number;
  gmailMessageId?: string;
  skippedEmpty?: boolean;
  dispatchedScheduleVersion?: number;
  dispatchedConfigHash?: string;
  manualResolution?: SheetsDigestManualResolution;
}

export type SheetsAppendLeaseStatus =
  | 'active'
  | 'dispatched'
  | 'unknown_outcome'
  | 'released';

export interface SheetsAppendDispatchMetadata {
  operation: 'append' | 'upsert';
  rowCount: number;
  candidateKeys?: string[];
  keyColumns?: number[] | null;
}

export interface SheetsAppendLeaseState {
  scopeKey: string;
  spreadsheetId: string;
  sheetTitle: string;
  leaseId: string;
  ownerId: string;
  fencingToken: number;
  status: SheetsAppendLeaseStatus;
  acquiredAt?: string;
  expiresAt?: string;
  dispatchedAt?: string | null;
  unknownReason?: string | null;
  dispatchedMeta?: SheetsAppendDispatchMetadata | null;
}

export interface SheetsAppendLeaseAcquireInput {
  scopeKey: string;
  spreadsheetId: string;
  sheetTitle: string;
  ownerId: string;
  ttlMs?: number;
  signal?: AbortSignal;
  onContention?: () => Promise<void>;
}

export interface SheetsAppendLeaseHandle {
  leaseId: string;
  fencingToken: number;
  waitedForContention: boolean;
  beginWriteDispatch?: (meta?: SheetsAppendDispatchMetadata) => Promise<void>;
  completeWrite?: () => Promise<void>;
  abortUncommittedWrite?: () => Promise<void>;
  release: () => Promise<void>;
  markUnknownOutcome?: (reason: string, meta?: SheetsAppendDispatchMetadata) => Promise<void>;
}

/**
 * @deprecated Unsupported in production primitives. Manual override of `unknown_outcome`
 * append leases is rejected fail-closed until an authenticated, authorized, and durably
 * audited operator recovery service is introduced.
 */
export type SheetsAppendManualRecoveryDecision =
  | 'operator_confirm_aborted_allow_retry'
  | 'operator_acknowledge_duplicate_risk';

export interface SheetsAppendLeaseReconcileInput {
  scopeKey: string;
  leaseId?: string;
  fencingToken?: number;
  reason?: string;
  verify?: (state: SheetsAppendLeaseState) => Promise<boolean>;
  /**
   * @deprecated Unsupported and rejected fail-closed in production stores/adapters
   * pending a future authenticated, authorized, and durably audited operator service.
   */
  manualOperatorDecision?: SheetsAppendManualRecoveryDecision;
  /**
   * @deprecated Unsupported and rejected fail-closed in production stores/adapters
   * pending a future authenticated, authorized, and durably audited operator service.
   */
  acknowledgeDuplicateRisk?: boolean;
  /**
   * @deprecated Unsupported and rejected fail-closed in production stores/adapters
   * pending a future authenticated, authorized, and durably audited operator service.
   */
  confirmDuplicateRisk?: boolean;
}

export interface SheetsAppendLeaseStore {
  acquireLease(input: SheetsAppendLeaseAcquireInput): Promise<SheetsAppendLeaseHandle>;
  getLeaseState?(scopeKey: string): Promise<SheetsAppendLeaseState | null>;
  reconcileUnknownLease?(input: SheetsAppendLeaseReconcileInput): Promise<boolean>;
}

export interface CalendarDigestConfig {
  version: 1;
  source: 'mycalendar';
  credentialId: string;
  email: string;
  calendars: Array<{ id: string; summary: string; primary?: boolean }>;
  destination:
    | { service: 'slack'; channelId: string; channelName?: string }
    | { service: 'telegram'; chatId: string; chatTitle?: string };
  windowHours: number;
  includeSummary: boolean;
}

export interface CalendarDigestCandidate {
  canAutoDigest?: boolean;
  defaultMode?: ScheduleApprovalMode;
  disabledReason?: string;
  configPreview?: {
    email: string;
    calendars: Array<{ id: string; summary: string; primary?: boolean }>;
    destinationService: 'slack' | 'telegram';
    destinationId: string;
    destinationLabel: string;
  };
  eligible?: boolean;
  config?: CalendarDigestConfig;
  reason?: string;
}

export interface CalendarDigestDelivery {
  destinationService?: 'slack' | 'telegram';
  channelId: string;
  channelName?: string;
  calendarsChecked: number;
  totalEvents: number;
  conflictCount: number;
  summaryIncluded: boolean;
  sentAt: string;
}

export interface GithubDigestConfig {
  credentialId: string;
  githubUserId: string;
  login: string;
  repos: string[];
  channelId: string;
  channelName: string;
  staleDays: number;
  telegramChatId?: string;
  telegramChatTitle?: string;
  telegramCredentialId?: string;
  telegramUserId?: string;
  telegramUsername?: string;
}

export interface GithubDigestDelivery {
  channelId: string;
  channelName: string;
  ts: string | null;
  counts: { newIssues: number; stalePrs: number; unassignedIssues: number };
  telegramChatId?: string;
  telegramChatTitle?: string;
  messageId?: number | null;
}

export interface ScheduleDigestCandidate {
  canAutoDigest: boolean;
  disabledReason?: string;
  config?: GithubDigestConfig;
  configHash?: string;
}

export interface GmailDigestBinding {
  kind: 'gmail';
  credentialId: string;
  email: string;
  oauthClientId: string;
}

export interface NotionDigestSourceBinding {
  version: 1;
  ownerId: string;
  credentialId: string;
  appId: string;
  workspaceId: string;
  actorId: string;
  botId: string;
  identityVersion: number;
  workspaceName: string;
  databases: Array<{ databaseId: string; dataSourceId: string; title: string }>;
}

export interface TelegramDigestSource {
  service: string;
  tool: string;
  args?: Record<string, any>;
  label: string;
  binding?: GmailDigestBinding;
  notionBinding?: NotionDigestSourceBinding;
}

export interface TelegramDigestConfig {
  credentialId: string;
  telegramUserId: string;
  username: string;
  chatId: string;
  chatTitle: string;
  sourceBindingVersion?: 1;
  sources: TelegramDigestSource[];
  recurrence: ScheduleRecurrence;
  timeZone: string;
}

export interface TelegramDigestDelivery {
  chatId: string;
  chatTitle: string;
  messageId?: number;
  sentAt?: string;
  manualConfirmedAt?: string;
  manualResolution?: SheetsDigestManualResolution;
  sources: Array<{
    service: string;
    label: string;
    status: 'ok' | 'partial_error' | 'empty';
    truncated?: boolean;
    itemCount?: number;
    error?: string;
  }>;
}

export interface TelegramDigestCandidate {
  canAutoDigest: boolean;
  disabledReason?: string;
  config?: TelegramDigestConfig;
  configHash?: string;
}

export interface TrelloDigestConfig {
  credentialId: string;
  trelloMemberId: string;
  username: string;
  boards: Array<{ id: string; name: string }>;
  channelId: string;
  channelName: string;
  dueSoonHours: number;
  destination?: 'slack' | 'telegram';
  slackCredentialId?: string;
  telegramChatId?: string;
  telegramChatTitle?: string;
  telegramCredentialId?: string;
  includeAiSummary?: boolean;
}

export interface TrelloDigestCoverage {
  perBoardFetchLimit: number;
  perCategoryDisplayLimit: number;
  scannedCount: number;
  uniqueScannedCount: number;
  duplicateCountDropped: number;
  totalAvailable: 'UNKNOWN';
  isComplete: false;
  truncatedByFetchLimit: boolean;
  truncatedByDisplayLimit: boolean;
  matchedCounts: {
    overdueCards: number;
    dueSoonCards: number;
    unassignedCards: number;
  };
  displayedCounts: {
    overdueCards: number;
    dueSoonCards: number;
    unassignedCards: number;
  };
}

export interface TrelloDigestDelivery {
  channelId: string;
  channelName: string;
  ts: string | null;
  counts: { overdueCards: number; dueSoonCards: number; unassignedCards: number };
  coverage?: TrelloDigestCoverage;
  telegramChatId?: string;
  telegramChatTitle?: string;
  messageId?: number | null;
  sentAt?: string;
  manualConfirmedAt?: string;
  manualResolution?: SheetsDigestManualResolution;
}

export interface TrelloDigestCandidate {
  canAutoDigest: boolean;
  disabledReason?: string;
  config?: TrelloDigestConfig;
  configHash?: string;
}

export interface NotionDigestConfig {
  notionBinding?: NotionDigestSourceBinding;
  credentialId: string;
  workspaceId: string;
  workspaceName: string;
  botId: string;
  identityVersion: number;
  databases: Array<{ id: string; title: string; url?: string }>;
  channelId: string;
  channelName: string;
  telegramChatId?: string;
  telegramChatTitle?: string;
  includeAiSummary?: boolean;
}

export interface NotionDigestDelivery {
  channelId: string;
  channelName: string;
  ts: string | null;
  counts: { databasesChecked: number; totalPages: number };
  telegramChatId?: string;
  telegramChatTitle?: string;
  messageId?: number | null;
}

export interface NotionDigestCandidate {
  canAutoDigest: boolean;
  disabledReason?: string;
  config?: NotionDigestConfig;
  configHash?: string;
}

export interface ScheduleView {
  id: string; convId: string; version: number;
  name: string; request: string; recurrence: ScheduleRecurrence;
  /** Service ids chosen by the planner's router, never by the model. */
  services: string[];
  status: ScheduleStatus;
  pauseReason: string | null;
  /** ISO, at most 3; empty when no run is left. */
  nextRuns: string[];
  lastRun: ScheduleRunView | null;
  kind?: ScheduleKind;
  approvalMode?: ScheduleApprovalMode;
  digestConfig?: SheetsDigestConfig | CalendarDigestConfig | GithubDigestConfig | TelegramDigestConfig | TrelloDigestConfig | NotionDigestConfig | null;
  digest?:
    | { config: GithubDigestConfig; approvedAt: string }
    | { config: TrelloDigestConfig; approvedAt: string }
    | { config: NotionDigestConfig; approvedAt: string }
    | { config: Record<string, unknown>; approvedAt: string }
    | {
        chatId: string;
        chatTitle: string;
        sources: Array<{ service: string; label: string }>;
        approvedAt: string | null;
      }
    | null;
}

/** Derived for display from schedule_runs.status and the run conversation's latest plan. */
export type ScheduleRunState =
  | 'planning' | 'awaiting_approval' | 'approved' | 'expired' | 'rejected'
  | 'needs_attention' | 'planning_failed' | 'interrupted' | 'discarded' | 'missed' | 'blocked'
  | 'digest_sent' | 'digest_failed';

export type ScheduleRunDeliveryResolution = 'confirmed_sent' | 'retried_new_run';

export interface ScheduleRunView {
  id: string; scheduleId: string;
  trigger: 'scheduled' | 'manual' | 'replan';
  dueAt: string; createdAt: string;
  state: ScheduleRunState;
  /** Above 1 when several missed times were recorded as one run. */
  missedCount: number;
  convId: string | null; planId: string | null;
  /** Status of the run conversation's latest plan, when there is one. */
  planStatus: string | null;
  /** A Vietnamese sentence for the user. */
  error: string | null;
  delivery?: SheetsDigestDelivery | CalendarDigestDelivery | GithubDigestDelivery | TelegramDigestDelivery | TrelloDigestDelivery | NotionDigestDelivery | null;
  deliveryStartedAt?: string | null;
  deliveryResolution?: ScheduleRunDeliveryResolution | null;
  deliveryResolvedAt?: string | null;
  deliveryFollowupRunId?: string | null;
}

/** Metadata of the assistant message that carries a schedule proposal. */
export interface ScheduleProposalMetadata {
  type: 'schedule_proposal';
  proposal: ScheduleResponse;
  scheduleId: string | null;      // null when creating
  baseVersion: number | null;     // the schedule version this proposal changes; null when creating
  services: string[];
  nextRuns: string[];             // computed by the backend when the proposal is saved
  previous: Pick<ScheduleView, 'name' | 'request' | 'recurrence' | 'status'> | null;
  digestCandidate?:
    | SheetsDigestCandidate
    | CalendarDigestCandidate
    | ScheduleDigestCandidate
    | TelegramDigestCandidate
    | TrelloDigestCandidate
    | NotionDigestCandidate
    | { canAutoDigest: boolean; disabledReason?: string; config?: Record<string, unknown>; configHash?: string };
  reauthorize?: boolean;
  expiresAt?: string;
}

/** Metadata of the assistant message recording the schedule after each change. */
export interface ScheduleStateMetadata {
  type: 'schedule_state';
  schedule: ScheduleView;
}

/** Metadata of the user message the scheduler saves at the start of a run conversation. */
export interface ScheduleRunMessageMetadata {
  type: 'schedule_run';
  scheduleId: string; runId: string; name: string;
  dueAt: string; trigger: 'scheduled' | 'manual' | 'replan';
}

export type AllowedScope = Partial<Record<string, string[]>>;
