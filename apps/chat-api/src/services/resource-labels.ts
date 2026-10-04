import { getToolDefinition, type PlanResponse } from '@wap/tool-schemas';
import { groundingMemory, type WorkingMemory } from '@wap/planner';

/** Display-only projection of actual lookups; never part of the approved payload. */
export function resourceLabels(plan: PlanResponse, memory: WorkingMemory): Record<string, string> {
  const known = groundingMemory(memory.getAll(), memory.getEntity('__observed'));
  const entries = (key: string): Array<Record<string, any>> => {
    const value = known[key];
    return (Array.isArray(value) ? value : value ? [value] : []).filter(item => item && typeof item === 'object');
  };
  const name = (entity: Record<string, any>) => [entity.name, entity.fullName, entity.title].find(value => typeof value === 'string' && value.trim());
  const labels: Record<string, string> = Object.create(null);
  for (const step of plan.steps) {
    const properties = getToolDefinition(step.tool)?.inputSchema.properties ?? {};
    for (const [argument, schema] of Object.entries(properties)) {
      const annotation = schema as Record<string, any>;
      const key = annotation['x-resource'];
      if (typeof key !== 'string') continue;
      const values = Array.isArray(step.args[argument]) ? step.args[argument] : [step.args[argument]];
      for (const value of values) {
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        const entity = entries(key).find(item => String(item[annotation['x-resource-field'] ?? 'id']) === String(value));
        if (!entity || !name(entity)) continue;
        const board = typeof entity.boardId === 'string' ? entries('board').find(item => item.id === entity.boardId) : undefined;
        labels[String(value)] = `${name(entity)}${board && name(board) ? ` (board ${name(board)})` : ''}`;
      }
    }
  }
  return labels;
}
