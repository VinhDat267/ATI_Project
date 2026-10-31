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
}

/** The personal connections a plan was previewed with. */
export interface PlanConnections {
  myslack?: import('./myslack-plan-bindings.js').SlackPlanBindings;
  gmail?: { credentialId: string; email: string };
  mycalendar?: { credentialId: string; email: string; allowedCalendars: string[] };
  mysheets?: { credentialId: string; email: string; allowedSpreadsheets: string[] };
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
}

export interface PlanResponse {
  kind: 'plan';
  thinking: string;
  summary: string;
  steps: PlanStep[];
  warnings: string[];
  /** Written only by the server, after validation and before the plan hash is computed. */
  connections?: PlanConnections;
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
}

/** Derived for display from schedule_runs.status and the run conversation's latest plan. */
export type ScheduleRunState =
  | 'planning' | 'awaiting_approval' | 'approved' | 'expired' | 'rejected'
  | 'needs_attention' | 'planning_failed' | 'interrupted' | 'discarded' | 'missed' | 'blocked';

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
