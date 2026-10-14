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
  gmail?: { credentialId: string; email: string };
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

export type PlannerResponse = PlanResponse | ClarificationResponse | RefusalResponse | AnswerResponse;

export type AllowedScope = Partial<Record<string, string[]>>;
