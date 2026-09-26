import {
  WorkflowPlanSchema,
  collectReferences,
  conditionReferences,
  parseCondition,
  validateGraph,
  validatePlanTools,
  validateToolCall,
  type ArgValue,
  type TrustedTool,
} from '@wap/dsl';
import { PILOT_TOOL_CATALOG } from './gateway.js';
import { reviewedPlanningSchema } from './planner-context.js';

export type PilotQualityPlanIssueCode =
  | 'workflow_schema_invalid'
  | 'workflow_graph_invalid'
  | 'tool_contract_invalid'
  | 'reference_path_invalid';

// Only server-reviewed catalog entries supply identities, policies and schemas.
const trustedTools: readonly TrustedTool[] = PILOT_TOOL_CATALOG.map((tool) => ({
  server: tool.name.split('.')[0]!,
  name: tool.name,
  sideEffect: tool.sideEffect,
  policyVersion: tool.policyVersion,
  inputSchema: reviewedPlanningSchema(tool),
  outputSchema: tool.outputSchema,
}));

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function schemaProvesPath(schema: Record<string, unknown>, path: readonly string[]): boolean {
  let current = schema;
  for (const segment of path) {
    let next: unknown;
    if (current.type === 'object' && record(current.properties) && Object.hasOwn(current.properties, segment)) {
      next = current.properties[segment];
    } else if (current.type === 'array' && /^(0|[1-9][0-9]*)$/.test(segment)) {
      next = current.items;
    } else {
      return false;
    }
    if (!record(next)) return false;
    current = next;
  }
  return true;
}

/** validatePlanTools defers entire args with references. Check concrete subtrees
 * and required fields without resolving references or inventing output values. */
function literalsMatchSchema(tool: TrustedTool, schema: Record<string, unknown>, value: ArgValue): boolean {
  if (collectReferences(value).length === 0) {
    return validateToolCall({ ...tool, inputSchema: schema }, value, 'execution').ok;
  }
  if (typeof value === 'string') return true; // Reference values remain deferred.
  if (Array.isArray(value)) {
    if (schema.type !== 'array' || !record(schema.items)) return false;
    return value.every((item) => literalsMatchSchema(tool, schema.items as Record<string, unknown>, item));
  }
  if (!record(value) || schema.type !== 'object' || !record(schema.properties)) return false;
  const properties = schema.properties;
  if (Array.isArray(schema.required) && schema.required.some((key) => typeof key !== 'string' || !Object.hasOwn(value, key))) {
    return false;
  }
  return Object.entries(value).every(([key, entry]) => {
    if (Object.hasOwn(properties, key)) {
      return record(properties[key]) && literalsMatchSchema(tool, properties[key], entry as ArgValue);
    }
    if (schema.additionalProperties === false) return false;
    if (record(schema.additionalProperties)) return literalsMatchSchema(tool, schema.additionalProperties, entry as ArgValue);
    return schema.additionalProperties === undefined || schema.additionalProperties === true;
  });
}

/** Pure validation of the model's plan; no normalization, execution or output resolution. */
export function validatePilotQualityPlan(value: unknown): readonly PilotQualityPlanIssueCode[] {
  const parsed = WorkflowPlanSchema.safeParse(value);
  if (!parsed.success) return ['workflow_schema_invalid'];
  const plan = parsed.data;
  const issues = new Set<PilotQualityPlanIssueCode>();
  const graph = validateGraph(plan);
  if (!graph.ok) issues.add('workflow_graph_invalid');
  const toolCheck = validatePlanTools(plan, trustedTools);
  // validatePlanTools prepends the same graph issues. Only its additional
  // issues represent tool-contract failures; no raw messages escape this API.
  if (toolCheck.issues.length > graph.issues.length) issues.add('tool_contract_invalid');

  const toolFor = (identity: { server: string; name: string }) =>
    trustedTools.find((tool) => tool.server === identity.server && tool.name === identity.name);
  const steps = new Map(plan.steps.map((step) => [step.id, step]));
  const checkReferences = (entry: ArgValue) => {
    try {
      for (const ref of collectReferences(entry)) {
        if (ref.kind !== 'step') continue;
        const sourceStep = steps.get(ref.stepId);
        const sourceTool = sourceStep && toolFor(sourceStep.tool);
        if (!sourceTool || !schemaProvesPath(sourceTool.outputSchema, ref.path)) {
          issues.add('reference_path_invalid');
        }
      }
    } catch {
      issues.add('reference_path_invalid');
    }
  };

  for (const step of plan.steps) {
    const tool = toolFor(step.tool);
    if (tool) {
      try {
        if (!literalsMatchSchema(tool, tool.inputSchema, step.tool.args)) issues.add('tool_contract_invalid');
      } catch {
        issues.add('tool_contract_invalid');
      }
    }
    checkReferences(step.tool.args);
    checkReferences(step.idempotency_key);
    if (step.condition) {
      try {
        conditionReferences(parseCondition(step.condition)).forEach(checkReferences);
      } catch {
        issues.add('workflow_graph_invalid');
      }
    }
  }
  Object.values(plan.outputs).forEach(checkReferences);
  const order: readonly PilotQualityPlanIssueCode[] = [
    'workflow_schema_invalid', 'workflow_graph_invalid', 'tool_contract_invalid', 'reference_path_invalid',
  ];
  return order.filter((issue) => issues.has(issue));
}
