import { isSlackReadTool, type ToolDefinition, type PlannerResponse, type PlanStep } from '@wap/tool-schemas';
import { normalizedRecipient, observedThreads, observedWorkspaceRecipients, userEmailAddresses } from './recipients.js';

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
  /** Only the dedicated personal Slack metadata proposal path may request approved read plans. */
  slackReadPlan?: boolean;
}

export const INJECTION_PATTERNS = [
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /ignore (?:all |any )?(?:previous|prior|above) instructions/i,
  /bỏ qua (?:mọi |tất cả )?(?:chỉ dẫn|hướng dẫn)(?: trước)?/i,
  /system prompt override/i,
  /you are now in developer mode/i,
  /disregard (?:all |any )?(?:previous|prior|above) instructions/i,
];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateSchemaValue(value: unknown, schema: Record<string, any>, path: string): string | null {
  if (schema['x-recipient']) {
    if (!Array.isArray(value) || value.some(address => !normalizedRecipient(address))) return `${path} must contain literal bare email addresses; references and templates are forbidden`;
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 20)) return `${path} recipient count is out of range`;
  }
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
    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
      const anyMatched = schema.anyOf.some((branch: Record<string, any>) => {
        const reqs = Array.isArray(branch?.required) ? branch.required : [];
        return reqs.every((reqKey: string) => value[reqKey] !== undefined && value[reqKey] !== null);
      });
      if (!anyMatched) {
        const options = schema.anyOf
          .flatMap((b: Record<string, any>) => (Array.isArray(b?.required) ? b.required : []))
          .join(' or ');
        return `${path} requires at least one of: ${options}`;
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

/** Raw strings stay literal in the executor; only structured references are resolved. */
function findRawStepPlaceholder(value: unknown, path: string, userTexts: string[]): string | null {
  if (typeof value === 'string') {
    for (const [placeholder] of value.matchAll(/\$\{\s*[A-Za-z_][\w-]*\.output\b[^}]*\}/g)) {
      // Preserve each placeholder the user typed verbatim, not model/search text.
      if (userTexts.some((text) => text.includes(placeholder))) continue;
      return `${path} contains raw step placeholder '${placeholder}'. Use { "$template": "..." } for interpolated text or { "$ref": "..." } for a previous step's output.`;
    }
  } else if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const error = findRawStepPlaceholder(child, `${path}[${index}]`, userTexts);
      if (error) return error;
    }
  } else if (isObject(value)) {
    if (Object.keys(value).length === 1 &&
      (typeof value.$template === 'string' || typeof value.$ref === 'string')) return null;
    for (const [key, child] of Object.entries(value)) {
      const error = findRawStepPlaceholder(child, `${path}.${key}`, userTexts);
      if (error) return error;
    }
  }
  return null;
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

function matchesWordExact(text: string, token: string): boolean {
  if (!token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, (m) => '\\' + m);
  return new RegExp(`(?<![\\p{L}\\p{N}_-]|(?:[\\p{L}\\p{N}]\\.))${escaped}(?![\\p{L}\\p{N}_-]|(?:\\.[\\p{L}\\p{N}]))`, 'iu').test(text);
}

function findAmbiguousSites(steps: PlanStep[], grounding: GroundingContext): UngroundedArgument[] {
  const sites = grounding.memory.jira_site;
  const availableSites = (Array.isArray(sites) ? sites : sites ? [sites] : [])
    .filter((s): s is Record<string, unknown> => isObject(s) && (typeof s.siteId === 'string' || typeof s.id === 'string'));
  if (availableSites.length <= 1) return [];

  const JIRA_GENERIC_WORDS = new Set([
    ['j', 'i', 'r', 'a'].join(''),
    'atlassian', 'net', 'com', 'site', 'cloud', 'workspace', 'http', 'https', 'www', 'app', 'instance', 'org', 'io',
  ]);

  const extractTokens = (s: Record<string, unknown>): Set<string> => {
    const tokens = new Set<string>();
    const siteId = typeof s.siteId === 'string' ? s.siteId.trim().toLowerCase() : '';
    const id = typeof s.id === 'string' ? s.id.trim().toLowerCase() : '';
    const cloudId = typeof s.cloudId === 'string' ? s.cloudId.trim().toLowerCase() : '';
    if (siteId) tokens.add(siteId);
    if (id) tokens.add(id);
    if (cloudId) tokens.add(cloudId);

    if (typeof s.name === 'string') {
      const name = s.name.trim().toLowerCase();
      if (name) tokens.add(name);
      for (const word of name.split(/[^\p{L}\p{N}]+/u)) {
        if (word.length >= 2 && !JIRA_GENERIC_WORDS.has(word)) {
          tokens.add(word);
        }
      }
    }

    if (typeof s.url === 'string') {
      const rawUrl = s.url.trim().toLowerCase();
      tokens.add(rawUrl);
      try {
        const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
        tokens.add(parsed.hostname);
        const parts = parsed.hostname.split('.');
        if (parts.length > 2 && parts[0] && parts[0].length >= 2 && !JIRA_GENERIC_WORDS.has(parts[0])) {
          tokens.add(parts[0]);
        }
      } catch {
        const match = rawUrl.match(/(?:https?:\/\/)?([a-z0-9_-]+)(?:\.[a-z0-9_.-]+)?/i);
        if (match?.[1] && match[1].length >= 2 && !JIRA_GENERIC_WORDS.has(match[1].toLowerCase())) {
          tokens.add(match[1].toLowerCase());
        }
      }
    }
    return tokens;
  };

  const siteTokenMaps = availableSites.map((s) => ({
    site: s,
    tokens: extractTokens(s),
  }));

  const tokenFrequencies = new Map<string, number>();
  for (const { tokens } of siteTokenMaps) {
    for (const token of tokens) {
      tokenFrequencies.set(token, (tokenFrequencies.get(token) ?? 0) + 1);
    }
  }

  const sitesMatchingText = (text: string): Record<string, unknown>[] => {
    const matched: Record<string, unknown>[] = [];
    for (const item of siteTokenMaps) {
      const s = item.site;
      // Distinctive tokens are those that appear in ONLY this site among availableSites
      const distinctiveTokens = Array.from(item.tokens).filter((token) => tokenFrequencies.get(token) === 1);
      const matches = distinctiveTokens.some((token) => matchesWordExact(text, token));
      if (matches) {
        matched.push(s);
      }
    }
    return matched;
  };

  let targetSites: Record<string, unknown>[] = [];
  const userTexts = grounding.userTexts ?? [];
  for (let i = userTexts.length - 1; i >= 0; i--) {
    const text = userTexts[i];
    if (!text) continue;
    const matched = sitesMatchingText(text);
    if (matched.length > 0) {
      targetSites = matched;
      break;
    }
  }

  const ambiguous: UngroundedArgument[] = [];
  for (const step of steps) {
    if (!step.tool.startsWith('myjira.') || typeof step.args?.siteId !== 'string') continue;
    const matchesTarget = targetSites.some((s) => String(s.siteId ?? s.id) === step.args.siteId);
    if (!matchesTarget) {
      ambiguous.push({
        stepId: step.id,
        argument: 'siteId',
        resource: 'jira_site',
        value: step.args.siteId,
      });
    }
  }
  return ambiguous;
}

function findUngrounded(steps: PlanStep[], catalog: Map<string, ToolDefinition>, grounding: GroundingContext): UngroundedArgument[] {
  const typed = userTokens(grounding.userTexts);
  const typedEmails = userEmailAddresses(grounding.userTexts);
  const seenEmails = new Set(observedThreads(grounding.memory).flatMap(t => t.participants.map(normalizedRecipient).filter((a): a is string => Boolean(a))));
  const workspaceEmails = new Set(observedWorkspaceRecipients(grounding.memory).keys());
  const createdSheetsByResource = new Map<string, Set<string>>([
    ['mysheet', new Set()],
    ['sheet', new Set()],
  ]);
  const ungrounded: UngroundedArgument[] = [];
  for (const step of steps) {
    if (step.tool === 'mysheets.create_sheet' && typeof step.args?.title === 'string' && step.args.title.trim()) {
      createdSheetsByResource.get('mysheet')!.add(step.args.title.trim());
    }
    if (step.tool === 'sheets.create_sheet' && typeof step.args?.title === 'string' && step.args.title.trim()) {
      createdSheetsByResource.get('sheet')!.add(step.args.title.trim());
    }
    const properties = catalog.get(step.tool)?.inputSchema.properties ?? {};
    for (const [argument, schema] of Object.entries<Record<string, any>>(properties)) {
      if (schema['x-recipient'] && Array.isArray(step.args[argument])) {
        for (const value of step.args[argument]) {
          const address = normalizedRecipient(value);
          if (address && !typedEmails.has(address) && !seenEmails.has(address) && !workspaceEmails.has(address)) ungrounded.push({ stepId: step.id, argument, resource: 'recipient', value: address });
        }
        continue;
      }
      const resource = schema['x-resource'];
      if (typeof resource !== 'string' || step.args[argument] === undefined) continue;
      const known = memoryValues(grounding.memory, resource, schema['x-resource-field'] ?? 'id');
      const createdInEarlierStep = createdSheetsByResource.get(resource);
      if (createdInEarlierStep) {
        for (const createdTitle of createdInEarlierStep) known.add(createdTitle);
      }
      const values = Array.isArray(step.args[argument]) ? step.args[argument] as unknown[] : [step.args[argument]];
      for (const value of values) {
        // $ref/$template values come from an earlier step's real output.
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        if (resource === 'jira_site') {
          const siteEntries = grounding.memory.jira_site;
          const sites = (Array.isArray(siteEntries) ? siteEntries : siteEntries ? [siteEntries] : [])
            .filter((s): s is Record<string, unknown> => isObject(s));
          const verifiedSiteIds = new Set(
            sites
              .filter((s) => typeof s.cloudId === 'string' && Boolean(s.cloudId.trim()) && typeof s.workspaceId === 'string' && Boolean(s.workspaceId.trim()))
              .flatMap((s) => [
                typeof s.siteId === 'string' ? s.siteId : undefined,
                typeof s.id === 'string' ? String(s.id) : undefined,
                typeof s.cloudId === 'string' ? s.cloudId : undefined,
              ]).filter((id): id is string => typeof id === 'string')
          );
          if (!verifiedSiteIds.has(String(value))) {
            ungrounded.push({ stepId: step.id, argument, resource, value });
          }
          continue;
        }
        if (step.tool.startsWith('myjira.') && (resource === 'jira_project' || resource === 'jira_issue') &&
          typeof step.args.siteId === 'string') {
          const siteEntries = grounding.memory.jira_site;
          const sites = (Array.isArray(siteEntries) ? siteEntries : siteEntries ? [siteEntries] : [])
            .filter((s): s is Record<string, unknown> => isObject(s));
          const targetSite = sites.find((s) => s.siteId === step.args.siteId || s.id === step.args.siteId);

          if (!targetSite ||
              typeof targetSite.cloudId !== 'string' || !targetSite.cloudId.trim() ||
              typeof targetSite.workspaceId !== 'string' || !targetSite.workspaceId.trim()) {
            ungrounded.push({ stepId: step.id, argument, resource, value });
            continue;
          }

          const entries = grounding.memory[resource];
          const observed = (Array.isArray(entries) ? entries : [entries]).filter((entry): entry is Record<string, unknown> =>
            isObject(entry) && String(entry[schema['x-resource-field'] ?? 'id']) === String(value));
          if (observed.length > 0) {
            const matchesSite = observed.some((entry) => {
              if (entry.siteId !== step.args.siteId) return false;
              if (typeof entry.cloudId !== 'string' || !entry.cloudId.trim() || entry.cloudId !== targetSite.cloudId) return false;
              if (typeof entry.workspaceId !== 'string' || !entry.workspaceId.trim() || entry.workspaceId !== targetSite.workspaceId) return false;
              return true;
            });
            if (!matchesSite) {
              ungrounded.push({ stepId: step.id, argument, resource, value });
              continue;
            }
          } else {
            ungrounded.push({ stepId: step.id, argument, resource, value });
            continue;
          }
        }
        if (known.has(String(value)) || typed.has(String(value))) continue;
        ungrounded.push({ stepId: step.id, argument, resource, value });
      }
    }
    if (step.tool === 'trello.update_checklist_item' && typeof step.args?.cardId === 'string') {
      const cardEntries = [
        ...(Array.isArray(grounding.memory.card)
          ? grounding.memory.card
          : grounding.memory.card
            ? [grounding.memory.card]
            : []),
        ...(isObject(grounding.memory.__observed) && Array.isArray((grounding.memory.__observed as any).card)
          ? (grounding.memory.__observed as any).card
          : []),
      ].filter((c): c is Record<string, unknown> => isObject(c) && String(c.id) === step.args.cardId);

      const allItems: Array<{ id: string; name: string }> = [];
      for (const card of cardEntries) {
        if (!Array.isArray(card.checklists)) continue;
        for (const chk of card.checklists) {
          if (!isObject(chk)) continue;
          const items = Array.isArray(chk.checkItems)
            ? chk.checkItems
            : Array.isArray(chk.items)
              ? chk.items
              : [];
          for (const it of items) {
            if (isObject(it) && typeof it.id === 'string' && typeof it.name === 'string') {
              allItems.push({ id: it.id, name: it.name });
            }
          }
        }
      }

      if (allItems.length > 0) {
        const needle = typeof step.args.itemName === 'string' ? step.args.itemName.trim().toLowerCase() : '';
        const rawCheckItemId =
          typeof step.args.checkItemId === 'string' && step.args.checkItemId.trim()
            ? step.args.checkItemId.trim()
            : undefined;
        if (rawCheckItemId) {
          const byId = allItems.find((it) => it.id === rawCheckItemId);
          const partialMatches = needle
            ? allItems.filter(
                (it) => it.name.toLowerCase().includes(needle) || needle.includes(it.name.toLowerCase()),
              )
            : [];
          const matchesName =
            !needle ||
            byId?.name.trim().toLowerCase() === needle ||
            (partialMatches.length === 1 && partialMatches[0]!.id === rawCheckItemId);
          if (!byId || !matchesName) {
            ungrounded.push({
              stepId: step.id,
              argument: 'checkItemId',
              resource: 'checkItem',
              value: rawCheckItemId,
            });
          }
        } else if (needle) {
          const exactMatches = allItems.filter((it) => it.name.trim().toLowerCase() === needle);
          if (exactMatches.length === 0) {
            const partialMatches = allItems.filter(
              (it) => it.name.toLowerCase().includes(needle) || needle.includes(it.name.toLowerCase()),
            );
            if (partialMatches.length !== 1) {
              ungrounded.push({
                stepId: step.id,
                argument: 'itemName',
                resource: 'checkItem',
                value: String(step.args.itemName),
              });
            }
          } else if (exactMatches.length > 1) {
            ungrounded.push({
              stepId: step.id,
              argument: 'itemName',
              resource: 'checkItem',
              value: String(step.args.itemName),
            });
          }
        }
      }
    }
  }
  return ungrounded;
}

export function validateAnswer(raw: string, options: { readAnswers: boolean; hasReadData: boolean }): ValidationResult {
  if (!options.readAnswers) return { valid: false, layer: 'semantic', error: 'Read answers are disabled.' };
  let parsed: any;
  try { parsed = JSON.parse(raw); }
  catch { return { valid: false, layer: 'json', error: 'Answer must be valid JSON.' }; }
  if (parsed?.kind !== 'answer' || typeof parsed.text !== 'string' || !parsed.text.trim() || parsed.text.length > 4000) {
    return { valid: false, layer: 'schema', error: 'Answer requires non-empty text of at most 4000 characters.' };
  }
  if (!options.hasReadData) return { valid: false, layer: 'semantic', error: 'Search with a read tool first, or ask for clarification. No successful read data exists in this turn.' };
  // Provenance is supplied by the planner from executed reads, never by the model.
  return { valid: true, parsed: { kind: 'answer', text: parsed.text, lookups: [], usedDirectory: [] } };
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

    const placeholderError = findRawStepPlaceholder(step.args, `Step '${step.id}' args`, options.grounding?.userTexts ?? []);
    if (placeholderError) {
      return { valid: false, layer: 'semantic', error: placeholderError };
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

      const targetStep = stepMap.get(targetStepId);
      if (
        targetStep &&
        step.tool.startsWith('myjira.') &&
        targetStep.tool.startsWith('myjira.') &&
        typeof step.args?.siteId === 'string' &&
        typeof targetStep.args?.siteId === 'string'
      ) {
        let isCross = step.args.siteId !== targetStep.args.siteId;
        if (!isCross && options.grounding?.memory?.jira_site) {
          const siteEntries = options.grounding.memory.jira_site;
          const sites = (Array.isArray(siteEntries) ? siteEntries : [siteEntries]).filter(isObject);
          const siteA = sites.find((s) => String(s.siteId ?? s.id) === step.args.siteId);
          const siteB = sites.find((s) => String(s.siteId ?? s.id) === targetStep.args.siteId);
          if (siteA && siteB) {
            if (siteA.cloudId && siteB.cloudId && siteA.cloudId !== siteB.cloudId) isCross = true;
            if (siteA.workspaceId && siteB.workspaceId && siteA.workspaceId !== siteB.workspaceId) isCross = true;
          }
        }
        if (isCross) {
          return {
            valid: false,
            layer: 'semantic',
            error: `Cross-site reference: step '${step.id}' on site '${step.args.siteId}' cannot reference output of step '${targetStepId}' on site '${targetStep.args.siteId}'`,
          };
        }
      }

      // If referencing targetStepId.output.<prop>, verify prop exists in outputSchema
      if (parts[1] === 'output' && parts[2]) {
        const propName = parts[2];
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
  if (!steps.some(step => catalogMap.get(step.tool)?.sideEffect === 'write') &&
      !(options.slackReadPlan===true && steps.every(step=>isSlackReadTool(step.tool)))) {
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
    const ambiguousSites = findAmbiguousSites(steps, options.grounding);
    if (ambiguousSites.length > 0) {
      return {
        valid: false,
        layer: 'grounding',
        error: `Ambiguous site destination: multiple Jira sites exist in workspace, but target site was not specified by user: ${ambiguousSites.map(u => `${u.stepId}.siteId=${JSON.stringify(u.value)}`).join(', ')}. Clarify with the user to select the destination site.`,
        ungrounded: ambiguousSites,
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
