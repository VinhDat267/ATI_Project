import type { ToolDefinition, PlannerResponse, PlanStep } from '@wap/tool-schemas';

export interface ValidationSuccess {
  valid: true;
  parsed: PlannerResponse;
}

export interface ValidationFailure {
  valid: false;
  layer: 'json' | 'schema' | 'semantic' | 'security';
  error: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

const INJECTION_PATTERNS = [
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /ignore previous instructions/i,
  /system prompt override/i,
  /you are now in developer mode/i,
];

export function validatePlan(rawOutput: string, catalog: ToolDefinition[]): ValidationResult {
  // Layer 4: Security validate (Check for prompt injection escape markers)
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(rawOutput)) {
      return {
        valid: false,
        layer: 'security',
        error: `Security violation: output matched disallowed injection pattern ${pattern}`,
      };
    }
  }

  // Layer 1: JSON parse
  let parsed: any;
  try {
    parsed = JSON.parse(rawOutput);
  } catch (err: any) {
    return {
      valid: false,
      layer: 'json',
      error: `Failed to parse JSON: ${err?.message || err}`,
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      valid: false,
      layer: 'schema',
      error: 'Plan response must be a JSON object',
    };
  }

  // Layer 2: Schema validate
  const kind = parsed.kind;
  if (!['plan', 'clarification', 'refusal'].includes(kind)) {
    return {
      valid: false,
      layer: 'schema',
      error: `Invalid kind '${kind}'. Must be 'plan', 'clarification', or 'refusal'.`,
    };
  }

  if (kind === 'clarification') {
    if (!parsed.question || typeof parsed.question !== 'string' || !parsed.question.trim()) {
      return {
        valid: false,
        layer: 'schema',
        error: 'ClarificationResponse requires a non-empty string question',
      };
    }
    return { valid: true, parsed: parsed as PlannerResponse };
  }

  if (kind === 'refusal') {
    if (!parsed.reason || typeof parsed.reason !== 'string' || !parsed.reason.trim()) {
      return {
        valid: false,
        layer: 'schema',
        error: 'RefusalResponse requires a non-empty string reason',
      };
    }
    return { valid: true, parsed: parsed as PlannerResponse };
  }

  // kind === 'plan' -> Thinking Precedence enforcement
  if (!parsed.thinking || typeof parsed.thinking !== 'string' || !parsed.thinking.trim()) {
    return {
      valid: false,
      layer: 'schema',
      error: 'PlanResponse requires non-empty thinking string explaining reasoning before/with steps',
    };
  }

  if (!parsed.summary || typeof parsed.summary !== 'string') {
    return {
      valid: false,
      layer: 'schema',
      error: 'PlanResponse requires string summary',
    };
  }

  if (!Array.isArray(parsed.steps)) {
    return {
      valid: false,
      layer: 'schema',
      error: 'PlanResponse requires steps array',
    };
  }

  if (parsed.steps.length === 0) {
    return {
      valid: false,
      layer: 'semantic',
      error: 'Plan cannot be empty (must contain at least 1 step)',
    };
  }

  if (parsed.steps.length > 10) {
    return {
      valid: false,
      layer: 'semantic',
      error: `Plan exceeds maximum limit of 10 steps (found ${parsed.steps.length})`,
    };
  }

  // Layer 3: Semantic validate
  const catalogMap = new Map<string, ToolDefinition>(catalog.map((t) => [t.name, t]));
  const steps: PlanStep[] = parsed.steps;
  const allStepIds = new Set<string>(steps.map((s) => s.id));
  const stepMap = new Map<string, PlanStep>(steps.map((s) => [s.id, s]));
  const processedStepIds = new Set<string>();

  for (const [i, step] of steps.entries()) {
    if (!step || !step.id || typeof step.id !== 'string') {
      return {
        valid: false,
        layer: 'schema',
        error: `Step at index ${i} is missing valid id`,
      };
    }

    if (processedStepIds.has(step.id)) {
      return {
        valid: false,
        layer: 'semantic',
        error: `Duplicate step id '${step.id}'`,
      };
    }

    // Check tool catalog existence
    const toolDef = catalogMap.get(step.tool);
    if (!toolDef) {
      return {
        valid: false,
        layer: 'semantic',
        error: `Tool '${step.tool}' not found in catalog`,
      };
    }

    // Check required arguments for tool
    const requiredArgs = toolDef.inputSchema?.required || [];
    const stepArgs = step.args || {};
    for (const reqArg of requiredArgs) {
      if (stepArgs[reqArg] === undefined || stepArgs[reqArg] === null) {
        return {
          valid: false,
          layer: 'schema',
          error: `Step '${step.id}' is missing required argument '${reqArg}' for tool '${step.tool}'`,
        };
      }
    }

    // Check declared dependencies existence
    for (const depId of step.dependsOn || []) {
      if (!allStepIds.has(depId)) {
        return {
          valid: false,
          layer: 'semantic',
          error: `Dependency '${depId}' declared in step '${step.id}' does not exist in plan`,
        };
      }
    }

    // Check $ref targets and output property validity
    const args = step.args || {};
    const refTargets: string[] = [];

    function extractRefs(val: any) {
      if (!val) return;
      if (typeof val === 'object') {
        if (typeof val.$ref === 'string') {
          refTargets.push(val.$ref);
        }
        if (typeof val.$template === 'string') {
          const matches = val.$template.matchAll(/\$\{([^}]+)\}/g);
          for (const m of matches) {
            refTargets.push(m[1]);
          }
        }
        for (const child of Object.values(val)) {
          extractRefs(child);
        }
      }
    }
    extractRefs(args);

    for (const ref of refTargets) {
      const parts = ref.split('.');
      const targetStepId = parts[0];
      if (!targetStepId || !processedStepIds.has(targetStepId)) {
        return {
          valid: false,
          layer: 'semantic',
          error: `Referenced step '${targetStepId}' not found or forward reference in step '${step.id}'`,
        };
      }

      // If referencing targetStepId.output.<prop>, verify prop exists in outputSchema
      if (parts[1] === 'output' && parts[2]) {
        const propName = parts[2];
        const targetStep = stepMap.get(targetStepId);
        if (targetStep) {
          const targetToolDef = catalogMap.get(targetStep.tool);
          const outSchema = targetToolDef?.outputSchema;
          if (outSchema && outSchema.type === 'object' && outSchema.properties) {
            if (!(propName in outSchema.properties)) {
              return {
                valid: false,
                layer: 'semantic',
                error: `Referenced output property '${propName}' does not exist in output schema of tool '${targetStep.tool}'`,
              };
            }
          }
        }
      }
    }

    processedStepIds.add(step.id);
  }

  // Check DAG Acyclic (Cycle detection)
  const adj = new Map<string, string[]>();
  for (const step of steps) {
    adj.set(step.id, step.dependsOn || []);
  }

  const visited = new Map<string, 'unvisited' | 'visiting' | 'visited'>();
  for (const step of steps) {
    visited.set(step.id, 'unvisited');
  }

  function hasCycle(node: string): boolean {
    visited.set(node, 'visiting');
    for (const dep of adj.get(node) || []) {
      if (visited.get(dep) === 'visiting') return true;
      if (visited.get(dep) === 'unvisited' && hasCycle(dep)) return true;
    }
    visited.set(node, 'visited');
    return false;
  }

  for (const step of steps) {
    if (visited.get(step.id) === 'unvisited') {
      if (hasCycle(step.id)) {
        return {
          valid: false,
          layer: 'semantic',
          error: `Dependency cycle detected involving step '${step.id}'`,
        };
      }
    }
  }

  return {
    valid: true,
    parsed: parsed as PlannerResponse,
  };
}
