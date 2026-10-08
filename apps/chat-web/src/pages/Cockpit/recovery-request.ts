import { getToolDefinition } from '@wap/tool-schemas';
import type { ExecutionSnapshot } from '../../types';
import { savedArguments } from './RecoveryMoment';

/**
 * The edited-recovery request is posted as the user's own message and shown as the
 * current request, so it is written in plain Vietnamese: work numbers and schema
 * labels instead of step ids, references or JSON. The planner still receives every
 * corrected value and the remaining work, and its new plan needs a fresh approval.
 */
export function recoveryEditRequest(snapshot: ExecutionSnapshot, stepId: string, args: Record<string, unknown>, note?: string): string {
  const steps = snapshot.plan.steps ?? [];
  const number = (id: string) => steps.findIndex(step => step.id === id) + 1;
  const reference = (path: string) => { const index = number(path.trim().split('.')[0]); return index > 0 ? `(kết quả của việc ${index})` : '(kết quả của việc trước)'; };
  const text = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.replace(/\$\{([^}]*)\}/g, (_token, path: string) => reference(path));
    if (typeof value === 'boolean') return value ? 'có' : 'không';
    if (typeof value !== 'object') return String(value);
    if (Array.isArray(value)) return value.map(item => Array.isArray(item) ? item.map(text).join(', ') : text(item)).join(Array.isArray(value[0]) ? ' / ' : ', ');
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === 'string') return reference(record.$ref);
    if (typeof record.$template === 'string') return text(record.$template);
    return Object.entries(record).map(([key, item]) => `${key}: ${text(item)}`).join('; ');
  };
  const fields = (tool: string, values: Record<string, unknown>) => {
    const properties = (getToolDefinition(tool)?.inputSchema as { properties?: Record<string, { description?: string }> } | undefined)?.properties ?? {};
    return Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => [properties[key]?.description || key, text(value)] as const);
  };
  const failed = steps.find(step => step.id === stepId);
  const lines = [`Làm lại việc ${number(stepId)}${failed ? ` (${failed.description})` : ''} của kế hoạch đã dừng, với nội dung đã sửa:`,
    ...fields(failed?.tool ?? '', args).map(([label, value]) => `- ${label}: ${value}`)];
  const pending = steps.filter(step => snapshot.steps.find(row => row.stepId === step.id)?.status === 'pending');
  if (pending.length) {
    lines.push('Sau đó làm tiếp các việc chưa làm:');
    for (const step of pending) {
      const values = fields(step.tool, savedArguments(step.args, snapshot) as Record<string, unknown>).map(([label, value]) => `${label}: ${value}`).join('; ');
      lines.push(`- Việc ${number(step.id)} (${step.description})${values ? `: ${values}` : ''}`);
    }
  }
  lines.push('Không làm lại các việc đã xong.');
  if (note?.trim()) lines.push(`Ghi chú: ${note.trim()}`);
  return lines.join('\n');
}
