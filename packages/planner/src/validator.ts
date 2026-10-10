import type { ToolDefinition, PlannerResponse, PlanStep } from '@wap/tool-schemas';

export interface ValidationSuccess {
  valid: true;
  parsed: PlannerResponse;
}

export interface UngroundedArgument {
  stepId: string;
  argument: string;
  resource: string;
  value: string | number;
}

export interface ValidationFailure {
  valid: false;
  layer: 'json' | 'schema' | 'semantic' | 'security' | 'grounding';
  error: string;
  code?: 'READ_ONLY_PLAN';
  ungrounded?: UngroundedArgument[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/** Sources that may legitimately supply a resource identifier. */
export interface GroundingContext {
  /** Working memory; gather stores looked-up resources under their entity key. */
  memory: Record<string, any>;
  /** The user's own messages; identifiers they typed are not model inventions. */
  userTexts: string[];
}

export interface ValidatePlanOptions {
  grounding?: GroundingContext;
}

const INJECTION_PATTERNS = [
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /ignore previous instructions/i,
  /system prompt override/i,
  /you are now in developer mode/i,
];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateSchemaValue(value: unknown, schema: Record<string, any>, path: string): string | null {
  if (isObject(value) && ('$ref' in value || '$template' in value)) {
    const key = '$ref' in value ? '$ref' : '$template';
    if (schema.type !== 'string' || Object.keys(value).length !== 1 ||
      typeof value[key] !== 'string' || !value[key].trim()) {
      return `${path} must be a ${schema.type || 'valid'} value or a single non-empty ${key} string`;
    }
    return null;
  }

  if (schema.type === 'object') {
    if (!isObject(value)) return `${path} must be an object`;
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      if (value[required] === undefined || value[required] === null) {
        return `${path} is missing required argument '${required}'`;
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (!(key in properties)) {
        if (schema.additionalProperties === false) return `${path}.${key} is an additional property`;
        if (isObject(schema.additionalProperties)) {
          const error = validateSchemaValue(child, schema.additionalProperties, `${path}.${key}`);
          if (error) return error;
        }
      } else {
        const error = validateSchemaValue(child, properties[key], `${path}.${key}`);
        if (error) return error;
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (schema.items) {
      for (const [index, item] of value.entries()) {
        const error = validateSchemaValue(item, schema.items, `${path}[${index}]`);
        if (error) return error;
      }
    }
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value)) return `${path} must be an integer`;
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} must be a number`;
  } else if (schema.type === 'null') {
    if (value !== null) return `${path} must be null`;
  } else if (schema.type && typeof value !== schema.type) {
    return `${path} must be a ${schema.type}`;
  }
  if (schema.enum && !schema.enum.includes(value)) return `${path} must match an allowed value`;
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} is below minimum`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} is above maximum`;
  }
  return null;
}

function userTokens(texts: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const text of texts) {
    for (const raw of text.match(/[\p{L}\p{N}_#@./:-]+/gu) ?? []) {
      const token = raw.replace(/[.:/-]+$/u, '');
      if (!token) continue;
      tokens.add(token);
      if (/^[#@]/u.test(token)) tokens.add(token.slice(1));
    }
  }
  return tokens;
}

function memoryValues(memory: Record<string, any>, resource: string, field: string): Set<string> {
  const entity = memory[resource];
  const entries = Array.isArray(entity) ? entity : [entity];
  return new Set(entries
    .map((entry) => entry && typeof entry === 'object' ? entry[field] : undefined)
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .map(String));
}

/** Boards an observed entity is known to belong to. */
export function boardsOf(entity: Record<string, unknown> | undefined): string[] {
  if (!entity) return [];
  if (Array.isArray(entity.boardIds)) return entity.boardIds.map(String);
  return typeof entity.boardId === 'string' ? [entity.boardId] : [];
}

function entitiesWithId(memory: Record<string, any>, resource: string, id: string): Array<Record<string, unknown>> {
  const entity = memory[resource];
  const entries = Array.isArray(entity) ? entity : [entity];
  return entries.filter((entry) => entry && typeof entry === 'object' && String(entry.id) === id);
}

/**
 * Trello only assigns members of the card's board. A member is rejected when
 * every board it was seen on differs from the card's board; when either board
 * is unknown nothing is assumed.
 */
function findMembersOffBoard(steps: PlanStep[], memory: Record<string, any>): UngroundedArgument[] {
  const boardOfList = (listId: unknown) => typeof listId === 'string'
    ? [...new Set(entitiesWithId(memory, 'list', listId).flatMap(boardsOf))] : [];
  const cardBoards = new Map<string, string[]>();
  for (const step of steps) {
    if (step.tool === 'trello.create_card') cardBoards.set(step.id, boardOfList(step.args.listId));
  }
  const boardOfCard = (cardId: unknown): string[] => {
    const ref = cardId && typeof cardId === 'object' ? (cardId as { $ref?: unknown }).$ref : undefined;
    if (typeof ref === 'string') return cardBoards.get(ref.split('.')[0]!) ?? [];
    return typeof cardId === 'string' ? [...new Set(entitiesWithId(memory, 'card', cardId).flatMap(boardsOf))] : [];
  };
  const offBoard: UngroundedArgument[] = [];
  const check = (step: PlanStep, argument: string, value: unknown, boards: string[]) => {
    if (typeof value !== 'string' || boards.length !== 1) return;
    const seenOn = entitiesWithId(memory, 'member', value).flatMap(boardsOf);
    if (seenOn.length > 0 && !seenOn.includes(boards[0]!)) offBoard.push({ stepId: step.id, argument, resource: 'member', value });
  };
  for (const step of steps) {
    if (step.tool === 'trello.create_card' && Array.isArray(step.args.idMembers)) {
      for (const member of step.args.idMembers) check(step, 'idMembers', member, cardBoards.get(step.id) ?? []);
    }
    if (step.tool === 'trello.add_member') check(step, 'memberId', step.args.memberId, boardOfCard(step.args.cardId));
  }
  return offBoard;
}

function findUngrounded(steps: PlanStep[], catalog: Map<string, ToolDefinition>, grounding: GroundingContext): UngroundedArgument[] {
  const typed = userTokens(grounding.userTexts);
  const ungrounded: UngroundedArgument[] = [];
  for (const step of steps) {
    const properties = catalog.get(step.tool)?.inputSchema.properties ?? {};
    for (const [argument, schema] of Object.entries<Record<string, any>>(properties)) {
      const resource = schema['x-resource'];
      if (typeof resource !== 'string' || step.args[argument] === undefined) continue;
      const known = memoryValues(grounding.memory, resource, schema['x-resource-field'] ?? 'id');
      const values = Array.isArray(step.args[argument]) ? step.args[argument] as unknown[] : [step.args[argument]];
      for (const value of values) {
        // $ref/$template values come from an earlier step's real output.
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        if (known.has(String(value)) || typed.has(String(value))) continue;
        ungrounded.push({ stepId: step.id, argument, resource, value });
      }
    }
  }
  return ungrounded;
}

export function validatePlan(rawOutput: string, catalog: ToolDefinition[], options: ValidatePlanOptions = {}): ValidationResult {
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
    // Only routing can identify unavailable services; model-supplied names are untrusted.
    delete parsed.unavailableServices;
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

  for (const [index, step] of parsed.steps.entries()) {
    if (!isObject(step)) {
      return { valid: false, layer: 'schema', error: `Step at index ${index} must be an object` };
    }
    if (!Array.isArray(step.dependsOn) || step.dependsOn.some((dep) => typeof dep !== 'string')) {
      return { valid: false, layer: 'schema', error: `Step at index ${index} dependsOn must be an array of strings` };
    }
    if (typeof step.description !== 'string' || !step.description.trim()) {
      return { valid: false, layer: 'schema', error: `Step at index ${index} requires a description string` };
    }
    if (typeof step.tool !== 'string') {
      return { valid: false, layer: 'schema', error: `Step at index ${index} requires a tool string` };
    }
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

    const argsError = validateSchemaValue(step.args, toolDef.inputSchema, `Step '${step.id}' args`);
    if (argsError) {
      return { valid: false, layer: 'schema', error: `${argsError} for tool '${step.tool}'` };
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

  // A workflow must perform an action. Mixed read/write plans keep their existing contract.
  if (!steps.some(step => catalogMap.get(step.tool)?.sideEffect === 'write')) {
    return { valid: false, layer: 'semantic', code: 'READ_ONLY_PLAN', error: 'Plan must contain at least one write step' };
  }

  // Layer 5: Grounding — resource IDs must come from lookups, the user or earlier steps
  if (options.grounding) {
    const ungrounded = findUngrounded(steps, catalogMap, options.grounding);
    if (ungrounded.length > 0) {
      const listed = ungrounded.map((u) => `${u.stepId}.${u.argument}=${JSON.stringify(u.value)} (${u.resource})`).join(', ');
      return {
        valid: false,
        layer: 'grounding',
        error: `Unverified resource arguments: ${listed}. Use values from Working Memory, a $ref to an earlier step, or return a clarification asking the user for the resource.`,
        ungrounded,
      };
    }
    const offBoard = findMembersOffBoard(steps, options.grounding.memory);
    if (offBoard.length > 0) {
      const boardFor = (u: UngroundedArgument) => {
        const step = steps.find((candidate) => candidate.id === u.stepId)!;
        const listId = step.tool === 'trello.create_card' ? step.args.listId
          : steps.find((candidate) => candidate.id === String((step.args.cardId as any)?.$ref ?? '').split('.')[0])?.args.listId;
        return entitiesWithId(options.grounding!.memory, 'list', String(listId)).flatMap(boardsOf)[0] ?? 'the card board';
      };
      const listed = offBoard.map((u) => `${u.stepId}.${u.argument}=${JSON.stringify(u.value)} is not a member of board ${boardFor(u)}`).join('; ');
      return {
        valid: false,
        layer: 'grounding',
        error: `Member not on the card's board: ${listed}. Search members with that boardId, or ask the user which member to assign.`,
        ungrounded: offBoard,
      };
    }
  }

  return {
    valid: true,
    parsed: parsed as PlannerResponse,
  };
}
