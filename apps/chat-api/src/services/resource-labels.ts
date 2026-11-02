import { getToolDefinition, GMAIL_TOOLS, MYCALENDAR_TOOLS, MYSHEETS_TOOLS, type PlanResponse } from '@wap/tool-schemas';
import { groundingMemory, normalizedRecipient, observedThreads, userEmailAddresses, type WorkingMemory } from '@wap/planner';

/** Display-only projection of actual lookups; never part of the approved payload. */
export function resourceLabels(
  plan: PlanResponse,
  memory: WorkingMemory,
  userTexts: string[] = [],
  options?:
    | Array<{ boardId: string; boardName: string }>
    | {
        teamBoards?: Array<{ boardId: string; boardName: string }>;
        teamRepos?: Array<{ repoId: string; fullName: string; name: string }>;
        telegramChats?: Array<{ chatId: string; title: string }>;
      },
): Record<string, string> {
  const teamBoards = Array.isArray(options) ? options : options?.teamBoards;
  const teamRepos = Array.isArray(options) ? undefined : options?.teamRepos;
  const telegramChats = Array.isArray(options) ? undefined : options?.telegramChats;
  const known = groundingMemory(memory.getAll(), memory.getEntity('__observed'));
  const entries = (key: string): Array<Record<string, any>> => {
    const value = known[key];
    return (Array.isArray(value) ? value : value ? [value] : []).filter(item => item && typeof item === 'object');
  };
  const name = (entity: Record<string, any>) => [entity.name, entity.fullName, entity.title].find(value => typeof value === 'string' && value.trim());
  const labels: Record<string, string> = Object.create(null);
  const ambiguous = new Set<string>();
  const subjects = memory.getEntity('__labels')?.thread ?? {};
  const typed = userEmailAddresses(userTexts);
  const threads = observedThreads(memory.getAll());
  for (const step of plan.steps) {
    const properties = (getToolDefinition(step.tool) ?? GMAIL_TOOLS.find(t => t.name === step.tool) ?? MYCALENDAR_TOOLS.find(t => t.name === step.tool) ?? MYSHEETS_TOOLS.find(t => t.name === step.tool))?.inputSchema.properties ?? {};
    for (const [argument, schema] of Object.entries(properties)) {
      const annotation = schema as Record<string, any>;
      if (annotation['x-recipient'] && Array.isArray(step.args[argument])) for (const value of step.args[argument]) {
        const address = normalizedRecipient(value);
        if (!address) continue;
        if (typed.has(address)) labels[`recipient:${address}`] = 'user';
        else {
          const source = threads.find(t => t.participants.some(p => normalizedRecipient(p) === address));
          if (source && typeof subjects[source.id] === 'string') labels[`recipient:${address}`] = `thread:${subjects[source.id]}`;
        }
      }
      const key = annotation['x-resource'];
      if (typeof key !== 'string') continue;
      const parents = Object.entries(properties).filter(([other, property]) =>
        other !== argument && typeof (property as Record<string, any>)['x-resource'] === 'string');
      const values = Array.isArray(step.args[argument]) ? step.args[argument] : [step.args[argument]];
      for (const value of values) {
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        if (key === 'thread' && typeof subjects[String(value)] === 'string') { labels[String(value)] = subjects[String(value)]; continue; }
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
        const id = String(value);
        if (key === 'board' && teamBoards) {
          const tb = teamBoards.find((b) => b.boardId === id);
          if (tb) {
            labels[id] = tb.boardName;
            continue;
          }
        }
        if (key === 'repository' && teamRepos) {
          const tr = teamRepos.find((r) => r.fullName.toLowerCase() === id.toLowerCase() || r.repoId === id);
          if (tr) {
            labels[id] = tr.fullName;
            continue;
          }
        }
        if (key === 'chat' && telegramChats) {
          const tc = telegramChats.find((c) => c.chatId === id);
          if (tc) {
            labels[id] = tc.title;
            continue;
          }
        }
        const entity = identities.size === 1 ? candidates[0] : undefined;
        if (!entity || !name(entity)) continue;
        let boardTitle = typeof entity.boardId === 'string' ? name(entries('board').find(item => item.id === entity.boardId) ?? {}) : undefined;
        if (typeof entity.boardId === 'string' && teamBoards) {
          const tb = teamBoards.find((b) => b.boardId === entity.boardId);
          if (tb) boardTitle = tb.boardName;
        }
        const label = `${name(entity)}${boardTitle ? ` (board ${boardTitle})` : ''}`;
        if (ambiguous.has(id)) continue;
        if (Object.hasOwn(labels, id) && labels[id] !== label) { delete labels[id]; ambiguous.add(id); }
        else labels[id] = label;
      }
    }
  }
  return labels;
}
