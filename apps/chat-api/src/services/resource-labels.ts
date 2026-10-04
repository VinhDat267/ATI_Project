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
  const ambiguous = new Set<string>();
  for (const step of plan.steps) {
    const properties = getToolDefinition(step.tool)?.inputSchema.properties ?? {};
    for (const [argument, schema] of Object.entries(properties)) {
      const annotation = schema as Record<string, any>;
      const key = annotation['x-resource'];
      if (typeof key !== 'string') continue;
      const parents = Object.entries(properties).filter(([other, property]) =>
        other !== argument && typeof (property as Record<string, any>)['x-resource'] === 'string');
      const values = Array.isArray(step.args[argument]) ? step.args[argument] : [step.args[argument]];
      for (const value of values) {
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        const candidates = entries(key).filter(item =>
          String(item[annotation['x-resource-field'] ?? 'id']) === String(value) &&
          parents.every(([parent]) => {
            const scope = step.args[parent];
            return !Object.hasOwn(item, parent) ||
              (typeof scope !== 'string' && typeof scope !== 'number') || String(item[parent]) === String(scope);
          }));
        // An issue number is local to its repository. Match a retained parent
        // scope above; when lookups cannot distinguish entities, retain the ID.
        const identities = new Set(candidates.map(item => JSON.stringify([
          item.id, name(item), item.boardId, item.repo, ...parents.map(([parent]) => item[parent]),
        ])));
        const entity = identities.size === 1 ? candidates[0] : undefined;
        if (!entity || !name(entity)) continue;
        const board = typeof entity.boardId === 'string' ? entries('board').find(item => item.id === entity.boardId) : undefined;
        const id = String(value);
        const label = `${name(entity)}${board && name(board) ? ` (board ${name(board)})` : ''}`;
        if (ambiguous.has(id)) continue;
        if (Object.hasOwn(labels, id) && labels[id] !== label) { delete labels[id]; ambiguous.add(id); }
        else labels[id] = label;
      }
    }
  }
  return labels;
}
