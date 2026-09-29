/**
 * Input properties naming an external resource carry `x-resource` (the working
 * memory entity key filled by gather, e.g. 'list') and optionally
 * `x-resource-field` (the entity field holding the value, default 'id').
 * The planner rejects plans whose resource values were never looked up.
 */
export type JSONSchema = Record<string, any>;

export interface ToolDefinition {
  name: string;
  service: 'trello' | 'slack' | string;
  description: string;
  sideEffect: 'read' | 'write';
  riskLevel: 'low' | 'medium' | 'high';
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
  scopes: string[];
  scopeKey: 'boards' | 'channels' | 'repos';
  credentialFields: Array<{ key: string; label: string; type: 'text' | 'password' }>;
  intentKeywords: string[];
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

export interface PlanResponse {
  kind: 'plan';
  thinking: string;
  summary: string;
  steps: PlanStep[];
  warnings: string[];
}

export interface ClarificationResponse {
  kind: 'clarification';
  question: string;
  options?: string[];
  context: string;
}

export interface RefusalResponse {
  kind: 'refusal';
  reason: string;
  suggestion?: string;
}

export type PlannerResponse = PlanResponse | ClarificationResponse | RefusalResponse;

export interface AllowedScope {
  boards?: string[];
  channels?: string[];
  repos?: string[];
}
