import { getToolDefinition } from '@wap/tool-schemas';
import type { ExecutionSnapshot } from '../../types';
import { savedArguments } from './RecoveryMoment';
import { recoveryFieldLabel, recoveryOutputLabel } from './recovery-labels';

/**
 * The edited-recovery request is posted as the user's own message and shown as the
 * current request, so it is written in plain Vietnamese: work numbers and schema
 * labels instead of step ids, references or JSON. The planner still receives every
 * corrected value and the remaining work, and its new plan needs a fresh approval.
 */
export function recoveryEditRequest(snapshot: ExecutionSnapshot, stepId: string, args: Record<string, unknown>, note?: string): string {
  const steps = snapshot.plan.steps ?? [];
  const number = (id: string) => steps.findIndex(step => step.id === id) + 1;
  const reference = (path: string) => {
    const [id, ...segments] = path.trim().split('.');
    const index = number(id);
    const fields = segments[0] === 'output' ? segments.slice(1) : segments;
    return `(${fields.length ? recoveryOutputLabel(fields) : 'kết quả'} của ${index > 0 ? `việc ${index}` : 'việc trước'})`;
  };
  // Quote nested strings so separators, empty cells and string/number values keep
  // their boundaries. This is prose with explicit positions, not flattened JSON.
  const quote = (value: string) => `“${value.replace(/\\/g, '\\\\').replace(/“|”/g, character => `\\${character}`).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}”`;
  const text = (value: unknown, nested = false): string => {
    if (value === null) return '(không có giá trị)';
    if (value === undefined) return '(chưa có giá trị)';
    if (typeof value === 'string') return nested ? quote(value) : value;
    if (typeof value === 'boolean') return value ? 'có' : 'không';
    if (typeof value !== 'object') return String(value);
    if (Array.isArray(value)) {
      if (!value.length) return '(danh sách rỗng)';
      if (value.every(Array.isArray)) return value.map((row: unknown[], index) => `Dòng ${index + 1}: ${row.length ? row.map((cell, column) => `cột ${column + 1}: ${text(cell, true)}`).join('; ') : '(dòng rỗng)'}`).join('\n');
      return value.map((item, index) => `mục ${index + 1}: ${text(item, true)}`).join('; ');
    }
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === 'string') {
      const saved = savedArguments(record, snapshot);
      return saved === record ? reference(record.$ref) : text(saved, nested);
    }
    if (typeof record.$template === 'string') {
      const template = record.$template.replace(/\$\{([^}]*)\}/g, (_token, path: string) => {
        const ref = { $ref: path.trim() };
        const saved = savedArguments(ref, snapshot);
        // Templates are executable string content: mirror the executor's coercion,
        // while unresolved references still use their human-readable field label.
        return saved === ref ? reference(ref.$ref) : saved == null ? '' : String(saved);
      });
      return nested ? quote(template) : template;
    }
    const entries = Object.entries(record);
    return entries.length ? entries.map(([key, item]) => `thuộc tính ${quote(key)}: ${text(item, true)}`).join('; ') : '(đối tượng rỗng)';
  };
  const fields = (tool: string, values: Record<string, unknown>) => {
    const properties = (getToolDefinition(tool)?.inputSchema as { properties?: Record<string, { description?: string }> } | undefined)?.properties ?? {};
    return Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => [recoveryFieldLabel(tool, key, properties[key]?.description), text(value)] as const);
  };
  const failed = steps.find(step => step.id === stepId);
  const lines = [`Làm lại việc ${number(stepId)}${failed ? ` (${failed.description})` : ''} của kế hoạch đã dừng, với nội dung đã sửa:`,
    ...fields(failed?.tool ?? '', args).map(([label, value]) => `- ${label}: ${value}`)];
  const pending = steps.filter(step => snapshot.steps.find(row => row.stepId === step.id)?.status === 'pending');
  if (pending.length) {
    lines.push('Sau đó làm tiếp các việc chưa làm:');
    for (const step of pending) {
      const values = fields(step.tool, step.args).map(([label, value]) => `${label}: ${value}`).join('; ');
      lines.push(`- Việc ${number(step.id)} (${step.description})${values ? `: ${values}` : ''}`);
    }
  }
  lines.push('Không làm lại các việc đã xong.');
  if (note?.trim()) lines.push(`Ghi chú: ${note.trim()}`);
  return lines.join('\n');
}
