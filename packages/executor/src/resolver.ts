import type { StepOutputs } from './types.js';

/**
 * Resolve a reference expression like 'step_1.output.id' against stepOutputs map.
 */
export function resolveRef(ref: string, stepOutputs: StepOutputs): any {
  const dotIndex = ref.indexOf('.');
  const stepId = dotIndex === -1 ? ref : ref.slice(0, dotIndex);
  const path = dotIndex === -1 ? '' : ref.slice(dotIndex + 1);

  if (!stepOutputs.has(stepId)) {
    throw new Error(`Referenced step '${stepId}' output not found`);
  }

  const stepData = stepOutputs.get(stepId);

  if (!path) {
    return stepData;
  }

  // Handle both wrapped { output: ... } and direct step output objects
  let current: any =
    stepData !== null && typeof stepData === 'object' && 'output' in stepData
      ? stepData
      : { output: stepData };

  const parts = path.split('.');
  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object' ||
      !(part in current) ||
      current[part] === undefined
    ) {
      throw new Error(`Property '${path}' not found on step '${stepId}'`);
    }
    current = current[part];
  }

  return current;
}

/**
 * Resolve string interpolation expressions like 'Task: ${step_1.output.id}'
 */
export function resolveTemplate(template: string, stepOutputs: StepOutputs): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const trimmed = expr.trim();
    const resolved = resolveRef(trimmed, stepOutputs);
    return resolved !== undefined && resolved !== null ? String(resolved) : '';
  });
}

/**
 * Recursively resolves literals, $ref objects, and $template objects.
 */
export function resolveValue(value: any, stepOutputs: StepOutputs): any {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, stepOutputs));
  }

  // Check for $ref
  if ('$ref' in value && typeof value.$ref === 'string') {
    return resolveRef(value.$ref, stepOutputs);
  }

  // Check for $template
  if ('$template' in value && typeof value.$template === 'string') {
    return resolveTemplate(value.$template, stepOutputs);
  }

  // Normal object: resolve all properties recursively
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = resolveValue(val, stepOutputs);
  }
  return result;
}

/**
 * Resolves all arguments for a step by resolving $ref and $template values
 */
export function resolveArgs(
  rawArgs: Record<string, any>,
  stepOutputs: StepOutputs
): Record<string, any> {
  return resolveValue(rawArgs, stepOutputs) as Record<string, any>;
}
