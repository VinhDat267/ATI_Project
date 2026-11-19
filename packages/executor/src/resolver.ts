import type { StepOutputs } from './types.js';

function preDispatchRefError(message: string): Error {
  const err: any = new Error(message);
  err.details = { requestSent: false };
  return err;
}

/**
 * Resolve a reference expression like 'step_1.output.id' against stepOutputs map.
 */
export function resolveRef(ref: string, stepOutputs: StepOutputs): any {
  const dotIndex = ref.indexOf('.');
  const stepId = dotIndex === -1 ? ref : ref.slice(0, dotIndex);
  const path = dotIndex === -1 ? '' : ref.slice(dotIndex + 1);

  if (!stepOutputs.has(stepId)) {
    throw preDispatchRefError(`Referenced step '${stepId}' output not found`);
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

  const normalizedPath = path.replace(/\[(\d+)\]/g, '.$1');
  const parts = normalizedPath.split('.');
  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object' ||
      !(part in current) ||
      current[part] === undefined
    ) {
      throw preDispatchRefError(`Property '${path}' not found on step '${stepId}'`);
    }
    current = current[part];
  }

  return current;
}

const LABEL_FIELDS = ['title', 'name', 'summary', 'subject', 'text'] as const;

function readableLine(item: Record<string, any>): string | null {
  const label = LABEL_FIELDS.map((field) => item[field]).find(
    (value) => typeof value === 'string' && value.trim(),
  ) as string | undefined;
  const key = typeof item.key === 'string' && item.key.trim() ? item.key.trim() : undefined;
  if (!label && !key) return null;
  const status = typeof item.status === 'string' && item.status.trim() ? ` (${item.status.trim()})` : '';
  const url = typeof item.url === 'string' && item.url.trim() ? ` – ${item.url.trim()}` : '';
  const head = key && label ? `[${key}] ${label.trim()}` : (label ?? key)!.trim();
  return `${head}${status}${url}`;
}

/** Text form of a referenced value: arrays of records become one line per item, never "[object Object]". */
function formatTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '(không có mục nào)';
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return value.map((item) => formatTemplateValue(item)).join(', ');
    }
    return value
      .map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? `- ${readableLine(item as Record<string, any>) ?? JSON.stringify(item)}`
          : `- ${formatTemplateValue(item)}`,
      )
      .join('\n');
  }
  return readableLine(value as Record<string, any>) ?? JSON.stringify(value);
}

/**
 * A top-level `$ref` that resolves to an array/object for a parameter the tool declares as a string
 * is rendered as text (same format as `$template`) instead of reaching the adapter as structured data.
 */
export function coerceStringParams(
  rawArgs: Record<string, any>,
  resolvedArgs: Record<string, any>,
  inputSchema?: { properties?: Record<string, any> },
): Record<string, any> {
  const properties = inputSchema?.properties;
  if (!properties) return resolvedArgs;
  let result = resolvedArgs;
  for (const [key, raw] of Object.entries(rawArgs ?? {})) {
    const value = resolvedArgs[key];
    const isRef = raw !== null && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.$ref === 'string';
    const propSchema = properties[key];
    if (!isRef || !propSchema) continue;
    const types: string[] = Array.isArray(propSchema.type)
      ? propSchema.type
      : typeof propSchema.type === 'string'
        ? [propSchema.type]
        : [];
    if (types.length === 0) continue;

    if (types.includes('string')) {
      const nullAllowed = value === null && types.includes('null');
      if (value !== undefined && typeof value !== 'string' && !nullAllowed && !types.includes(typeof value)) {
        if (result === resolvedArgs) result = { ...resolvedArgs };
        result[key] = formatTemplateValue(value);
      }
    } else if (
      (types.includes('integer') || types.includes('number')) &&
      typeof value === 'string' &&
      /^-?\d+(?:\.\d+)?$/.test(value.trim())
    ) {
      const n = Number(value.trim());
      const validNum =
        (types.includes('integer') && Number.isSafeInteger(n)) ||
        (types.includes('number') && Number.isFinite(n));
      if (validNum) {
        if (result === resolvedArgs) result = { ...resolvedArgs };
        result[key] = n;
      }
    }
  }
  return result;
}

/**
 * Resolve string interpolation expressions like 'Task: ${step_1.output.id}'
 */
export function resolveTemplate(template: string, stepOutputs: StepOutputs): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const trimmed = expr.trim();
    return formatTemplateValue(resolveRef(trimmed, stepOutputs));
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
