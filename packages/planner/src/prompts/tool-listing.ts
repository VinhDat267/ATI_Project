import type { ToolDefinition } from '@wap/tool-schemas';

type Schema = Record<string, any>;

function typeOf(schema: Schema): string {
  if (schema.type === 'array') return `${schema.items?.type ?? 'any'}[]`;
  const bounds = [
    schema.minimum !== undefined ? `≥${schema.minimum}` : '',
    schema.maximum !== undefined ? `≤${schema.maximum}` : '',
  ].filter(Boolean).join(' ');
  return bounds ? `${schema.type} ${bounds}` : String(schema.type ?? 'any');
}

function argument(name: string, schema: Schema, required: boolean): string {
  const resource = schema['x-resource'];
  const field = schema['x-resource-field'];
  const tag = resource ? ` [x-resource: ${resource}${field ? `.${field}` : ''}]` : '';
  // A resource tag already says what the value is; other arguments keep their hint.
  const hint = !resource && schema.description ? ` — ${schema.description}` : '';
  return `${name}${required ? '*' : ''} ${typeOf(schema)}${tag}${hint}`;
}

function returns(schema: Schema): string {
  const list = schema.type === 'array';
  const fields = Object.keys((list ? schema.items : schema)?.properties ?? {});
  return `returns ${list ? 'list of ' : ''}{ ${fields.join(', ')} }`;
}

/**
 * One tool as a signature instead of two JSON schemas: the same argument names,
 * types, required markers, resource tags and returned fields in about half the text.
 */
export function describeToolCompact(tool: ToolDefinition): string {
  const required = new Set<string>(tool.inputSchema.required ?? []);
  const args = Object.entries<Schema>(tool.inputSchema.properties ?? {})
    .map(([name, schema]) => argument(name, schema, required.has(name)));
  return `- ${tool.name} (${tool.sideEffect}, risk: ${tool.riskLevel}): ${tool.description}\n  args: ${args.join('; ')}\n  ${returns(tool.outputSchema)}`;
}

export const COMPACT_LEGEND = 'Arguments marked * are required; a tool accepts only the arguments listed for it.';
