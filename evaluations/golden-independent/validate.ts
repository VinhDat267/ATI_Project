/**
 * W4-01 independent golden set: format checks for cases written by members who
 * did not write the planner prompt. Messages are Vietnamese because the writers
 * read them. Checks format only; never whether the planner would pass a case.
 *
 *   node --import tsx evaluations/golden-independent/validate.ts [file.json] [--partial]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ALL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import { knownResourceValues } from '../golden-v2/fixtures.js';
import type { GoldenCase, Matcher, StepSpec } from '../golden-v2/scorer.js';

/** Same shape as the golden-v2 runner's GoldenFile; declared here to keep run.ts out of this import graph. */
export interface GoldenFile { version: number; clock: string; timeZone: string; cases: GoldenCase[] }

export const CLOCK = '2026-09-29T10:00:00+07:00';
export const TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const MIN_CASES = 30;
export const MIN_PER_CATEGORY = 4;
export const MIN_PER_LANGUAGE = 5;
/** The five groups the task card requires; read_only is optional and not counted. */
export const REQUIRED_CATEGORIES = ['single_step', 'multi_step', 'cross_service', 'clarification', 'refusal'] as const;
const CATEGORIES = new Set<string>([...REQUIRED_CATEGORIES, 'read_only']);
const CASE_FIELDS = new Set(['id', 'category', 'language', 'author', 'services', 'prompt', 'expect']);
const EXPECT_FIELDS = new Set(['kind', 'steps', 'anyOf', 'allowExtraTools']);
const MATCHER_FIELDS = new Set(['equals', 'instantEquals', 'startsWith', 'endsWith', 'includesAny', 'includesAll', 'contains', 'minItems', 'refTo', 'absent', 'anyOf']);
const toolByName = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));
const services = new Set(SERVICE_REGISTRY.map((service) => service.id));
const normalize = (text: string) => text.toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim();

/** Prompts of the earlier sets and of the guide's examples; a new case must not reuse them. */
export function reservedPrompts(): Set<string> {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const earlier = ['cases.json', 'cases-freeform.json', 'cases-services.json']
    .flatMap((file) => (JSON.parse(read(`../golden-v2/${file}`)) as GoldenFile).cases.map((c) => c.prompt));
  return new Set([...earlier, ...guideExamples(read('./GUIDE.md')).map((c) => c.prompt)].map(normalize));
}

/** JSON blocks in GUIDE.md whose id starts with "vd-" are the worked examples. */
export function guideExamples(markdown: string): GoldenCase[] {
  return [...markdown.matchAll(/```json\n([\s\S]*?)```/g)]
    .map((block) => { try { return JSON.parse(block[1]!) as unknown; } catch { return undefined; } })
    .filter((value): value is GoldenCase => !!value && typeof value === 'object' && String((value as GoldenCase).id ?? '').startsWith('vd-'));
}

/** JSON Schema types an argument accepts, with integer folded into number; null when the schema does not say. */
function schemaTypes(schema: unknown): Set<string> | null {
  if (!schema || typeof schema !== 'object') return null;
  const { type, anyOf, oneOf } = schema as { type?: unknown; anyOf?: unknown; oneOf?: unknown };
  const listed = Array.isArray(type) ? type : typeof type === 'string' ? [type] : null;
  if (listed) return new Set(listed.map((t) => (t === 'integer' ? 'number' : String(t))));
  const alternatives = Array.isArray(anyOf) ? anyOf : Array.isArray(oneOf) ? oneOf : null;
  if (!alternatives) return null;
  const sets = alternatives.map(schemaTypes);
  return sets.every((set) => set) ? new Set(sets.flatMap((set) => [...set!])) : null;
}
const TYPE_NAMES: Record<string, string> = { string: 'chữ', number: 'số', boolean: 'true/false', array: 'danh sách', object: 'object' };
const typeName = (types: Set<string>) => [...types].map((t) => TYPE_NAMES[t] ?? t).join(' hoặc ');
const valueType = (value: unknown) => (typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string');

/** Conditions that no schema-valid argument can meet, given how scorer.ts compares them. */
function typeProblems(where: string, m: Matcher, property: Record<string, any>): string[] {
  const types = schemaTypes(property);
  if (!types) return [];
  const problems: string[] = [];
  const accepts = (...wanted: string[]) => wanted.some((t) => types.has(t));
  if ('equals' in m && ['string', 'number', 'boolean'].includes(typeof m.equals) && !accepts(valueType(m.equals)))
    problems.push(`${where}: "equals" là ${TYPE_NAMES[valueType(m.equals)]}, nhưng tham số này nhận ${typeName(types)}`);
  for (const key of ['startsWith', 'endsWith', 'instantEquals'] as const)
    if (key in m && !accepts('string')) problems.push(`${where}: "${key}" chỉ dùng cho tham số chữ; tham số này nhận ${typeName(types)}`);
  for (const key of ['includesAny', 'includesAll'] as const)
    if (key in m && !accepts('string', 'array')) problems.push(`${where}: "${key}" chỉ dùng cho tham số chữ hoặc danh sách; tham số này nhận ${typeName(types)}`);
  for (const key of ['contains', 'minItems'] as const)
    if (key in m && !accepts('array')) problems.push(`${where}: "${key}" chỉ dùng cho tham số danh sách; tham số này nhận ${typeName(types)}`);
  const items = schemaTypes(property.items);
  if ('contains' in m && accepts('array') && items && ['string', 'number'].includes(typeof m.contains) && !items.has(valueType(m.contains)))
    problems.push(`${where}: "contains" là ${TYPE_NAMES[valueType(m.contains)]}, nhưng mỗi phần tử của tham số này là ${typeName(items)}`);
  return problems;
}

function matcherProblems(where: string, matcher: unknown, property: Record<string, any>, prompt: string, alternative: StepSpec[]): string[] {
  if (!matcher || typeof matcher !== 'object' || Array.isArray(matcher)) return [`${where}: điều kiện phải là một object, ví dụ { "equals": "..." }`];
  const m = matcher as Matcher & Record<string, unknown>;
  const problems: string[] = [];
  const keys = Object.keys(m);
  if (!keys.length) problems.push(`${where}: điều kiện rỗng`);
  for (const key of keys) if (!MATCHER_FIELDS.has(key)) problems.push(`${where}: không có loại điều kiện "${key}"`);
  const isText = (value: unknown) => typeof value === 'string' && value.trim() !== '';
  const textList = (value: unknown) => Array.isArray(value) && value.length > 0 && value.every(isText);
  if ('equals' in m && !['string', 'number', 'boolean'].includes(typeof m.equals)) problems.push(`${where}: "equals" phải là chữ, số hoặc true/false`);
  for (const key of ['startsWith', 'endsWith'] as const) if (key in m && !isText(m[key])) problems.push(`${where}: "${key}" phải là chữ`);
  for (const key of ['includesAny', 'includesAll'] as const) if (key in m && !textList(m[key])) problems.push(`${where}: "${key}" phải là danh sách chữ, ví dụ ["homepage"]`);
  if ('instantEquals' in m && !(typeof m.instantEquals === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(m.instantEquals) && Number.isFinite(Date.parse(m.instantEquals))))
    problems.push(`${where}: "instantEquals" phải là thời điểm có múi giờ, ví dụ "2026-09-30T15:00:00+07:00"`);
  if ('contains' in m && !['string', 'number'].includes(typeof m.contains)) problems.push(`${where}: "contains" phải là chữ hoặc số`);
  if ('minItems' in m && !(Number.isInteger(m.minItems) && (m.minItems as number) > 0)) problems.push(`${where}: "minItems" phải là số nguyên dương`);
  if ('absent' in m && m.absent !== true) problems.push(`${where}: "absent" chỉ nhận true`);
  if ('refTo' in m) {
    const targets = [m.refTo].flat();
    if (!targets.length || !targets.every(isText)) problems.push(`${where}: "refTo" phải là tên tool hoặc danh sách tên tool`);
    for (const target of targets) if (isText(target) && !alternative.some((step) => step.tool === target))
      problems.push(`${where}: "refTo" trỏ tới ${String(target)}, nhưng phương án này không có bước nào dùng tool đó`);
  }
  if ('anyOf' in m) {
    if (!Array.isArray(m.anyOf) || !m.anyOf.length) problems.push(`${where}: "anyOf" phải là danh sách điều kiện không rỗng`);
    else m.anyOf.forEach((nested, index) => problems.push(...matcherProblems(`${where}.anyOf[${index}]`, nested, property, prompt, alternative)));
  }
  problems.push(...typeProblems(where, m, property));
  const resource = property['x-resource'] as string | undefined;
  for (const key of ['equals', 'contains'] as const) {
    if (!resource || !(key in m)) continue;
    const value = String(m[key]);
    if (!knownResourceValues(resource, property['x-resource-field']).has(value) && !prompt.includes(value))
      problems.push(`${where}: "${value}" không có trong workspace giả lập (mục 4 của GUIDE.md) và không có trong câu chat`);
  }
  return problems;
}

/** Per-case format problems; empty when the case is well formed. */
export function caseProblems(c: GoldenCase, reserved: Set<string> = new Set()): string[] {
  const id = typeof c?.id === 'string' ? c.id : '(không có id)';
  const at = (path: string) => `${id}${path}`;
  const problems: string[] = [];
  if (!c || typeof c !== 'object') return [`${id}: mỗi câu phải là một object`];
  for (const key of Object.keys(c)) if (!CASE_FIELDS.has(key)) problems.push(at(`: không có trường "${key}"`));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(c.id ?? ''))) problems.push(at(': "id" chỉ gồm chữ thường không dấu, số và dấu gạch ngang, ví dụ "m2-01"'));
  if (String(c.id ?? '').startsWith('vd-')) problems.push(at(': "id" bắt đầu bằng "vd-" là ví dụ của GUIDE.md, không nộp'));
  if (!CATEGORIES.has(c.category)) problems.push(at(`: "category" phải là một trong ${[...CATEGORIES].join(', ')}`));
  if (c.language !== 'vi' && c.language !== 'en') problems.push(at(': "language" phải là "vi" hoặc "en"'));
  if (c.author === 'author-v2') problems.push(at(': "author-v2" là người viết bộ câu cũ; bộ mới phải do người khác viết'));
  else if (!/^member-\d+$/.test(String(c.author ?? ''))) problems.push(at(': "author" phải là mã vai trò như "member-2", không ghi họ tên'));
  const prompt = typeof c.prompt === 'string' ? c.prompt : '';
  if (prompt.trim().length < 10) problems.push(at(': "prompt" phải là câu chat đầy đủ (ít nhất 10 ký tự)'));
  else if (reserved.has(normalize(prompt))) problems.push(at(': "prompt" trùng một câu của bộ cũ hoặc của ví dụ trong GUIDE.md'));
  const caseServices = Array.isArray(c.services) ? c.services : [];
  // A refusal or clarification may name no supported service at all, e.g. a request to send an email.
  const mayNameNone = (c.category === 'refusal' || c.category === 'clarification') && Array.isArray(c.services);
  if (!caseServices.length && !mayNameNone)
    problems.push(at(': "services" phải liệt kê các dịch vụ câu chat nhắc tới, ví dụ ["trello", "slack"]; chỉ câu hỏi lại hoặc từ chối không nhắc dịch vụ nào mới ghi []'));
  for (const service of caseServices) if (!services.has(service)) problems.push(at(`: không có dịch vụ "${service}"`));
  if (new Set(caseServices).size !== caseServices.length) problems.push(at(': "services" có dịch vụ lặp lại'));

  const expect = c.expect;
  if (!expect || typeof expect !== 'object') return [...problems, at(': thiếu "expect"')];
  for (const key of Object.keys(expect)) if (!EXPECT_FIELDS.has(key)) problems.push(at(`.expect: không có trường "${key}"`));
  const wantedKind = c.category === 'clarification' || c.category === 'read_only' ? 'clarification' : c.category === 'refusal' ? 'refusal' : 'plan';
  if (expect.kind !== wantedKind) problems.push(at(`.expect.kind: nhóm ${c.category} cần "${wantedKind}"`));
  if (wantedKind !== 'plan') {
    if (expect.steps || expect.anyOf || expect.allowExtraTools) problems.push(at(`.expect: nhóm ${c.category} không có bước, chỉ ghi "kind"`));
    return problems;
  }
  if (!!expect.steps === !!expect.anyOf) return [...problems, at('.expect: ghi đúng một trong hai: "steps" hoặc "anyOf"')];
  const alternatives = expect.anyOf ?? [expect.steps!];
  if (!Array.isArray(alternatives) || !alternatives.length) return [...problems, at('.expect.anyOf: phải có ít nhất một phương án')];
  alternatives.forEach((alternative, a) => {
    const path = expect.anyOf ? `.expect.anyOf[${a}]` : '.expect.steps';
    if (!Array.isArray(alternative) || !alternative.length) { problems.push(at(`${path}: phải có ít nhất một bước`)); return; }
    alternative.forEach((step, s) => {
      const where = at(`${path}[${s}]`);
      const tool = toolByName.get(step?.tool);
      if (!tool) { problems.push(`${where}: không có tool "${String(step?.tool)}"`); return; }
      if (tool.sideEffect !== 'write') problems.push(`${where}: ${tool.name} là tool đọc; bước của kế hoạch chỉ ghi tool ghi`);
      if (!caseServices.includes(tool.service)) problems.push(`${where}: ${tool.name} thuộc dịch vụ ${tool.service}, chưa có trong "services"`);
      for (const key of Object.keys(step)) if (key !== 'tool' && key !== 'args') problems.push(`${where}: không có trường "${key}"`);
      const args = step.args ?? {};
      if (!Object.keys(args).length) problems.push(`${where}: mỗi bước cần ít nhất một điều kiện cho tham số`);
      const properties = tool.inputSchema.properties as Record<string, Record<string, any>>;
      for (const [name, matcher] of Object.entries(args)) {
        if (!properties[name]) { problems.push(`${where}.${name}: ${tool.name} không có tham số "${name}"`); continue; }
        problems.push(...matcherProblems(`${where}.${name}`, matcher, properties[name], prompt, alternative));
      }
    });
    const tools = alternative.filter((step) => toolByName.has(step?.tool));
    const spanned = new Set(tools.map((step) => toolByName.get(step.tool)!.service));
    if (c.category === 'single_step' && alternative.length !== 1) problems.push(at(`${path}: nhóm single_step có đúng một bước`));
    if (c.category === 'multi_step' && spanned.size > 1) problems.push(at(`${path}: nhiều bước trên nhiều dịch vụ thuộc nhóm cross_service`));
    if (c.category === 'cross_service' && spanned.size < 2) problems.push(at(`${path}: nhóm cross_service cần bước trên ít nhất hai dịch vụ`));
  });
  if (c.category === 'multi_step' && !alternatives.some((alternative) => Array.isArray(alternative) && alternative.length >= 2))
    problems.push(at('.expect: nhóm multi_step cần ít nhất một phương án có từ hai bước'));
  for (const name of expect.allowExtraTools ?? []) {
    if (toolByName.get(name)?.sideEffect !== 'write') problems.push(at(`.expect.allowExtraTools: "${name}" không phải tool ghi`));
  }
  return problems;
}

/** Whole-file problems. `complete` adds the composition the task card requires before any model run. */
export function validateIndependentSet(file: GoldenFile, options: { complete?: boolean; reserved?: Set<string> } = {}): string[] {
  const problems: string[] = [];
  if (file?.version !== 1) problems.push('File: "version" phải là 1');
  if (file?.clock !== CLOCK) problems.push(`File: "clock" phải là "${CLOCK}"`);
  if (file?.timeZone !== TIME_ZONE) problems.push(`File: "timeZone" phải là "${TIME_ZONE}"`);
  if (!Array.isArray(file?.cases)) return [...problems, 'File: "cases" phải là một danh sách'];
  const reserved = options.reserved ?? reservedPrompts();
  const ids = new Set<string>(), prompts = new Set<string>();
  for (const c of file.cases) {
    problems.push(...caseProblems(c, reserved));
    if (ids.has(c?.id)) problems.push(`${c.id}: "id" bị trùng`);
    if (typeof c?.prompt === 'string' && prompts.has(normalize(c.prompt))) problems.push(`${c.id}: "prompt" trùng một câu khác trong bộ`);
    ids.add(c?.id); if (typeof c?.prompt === 'string') prompts.add(normalize(c.prompt));
  }
  if (options.complete) {
    if (file.cases.length < MIN_CASES) problems.push(`Bộ câu: cần ít nhất ${MIN_CASES} câu, hiện có ${file.cases.length}`);
    for (const category of REQUIRED_CATEGORIES) {
      const count = file.cases.filter((c) => c?.category === category).length;
      if (count < MIN_PER_CATEGORY) problems.push(`Bộ câu: nhóm ${category} cần ít nhất ${MIN_PER_CATEGORY} câu, hiện có ${count}`);
    }
    for (const language of ['vi', 'en'] as const) {
      const count = file.cases.filter((c) => c?.language === language).length;
      if (count < MIN_PER_LANGUAGE) problems.push(`Bộ câu: cần ít nhất ${MIN_PER_LANGUAGE} câu tiếng ${language === 'vi' ? 'Việt' : 'Anh'}, hiện có ${count}`);
    }
  }
  return problems;
}

export const CASES_PATH = 'evaluations/golden-independent/cases.json';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const partial = process.argv.includes('--partial');
  const path = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? CASES_PATH;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as GoldenFile | GoldenCase[];
    const file: GoldenFile = Array.isArray(parsed) ? { version: 1, clock: CLOCK, timeZone: TIME_ZONE, cases: parsed } : parsed;
    const problems = validateIndependentSet(file, { complete: !partial });
    const count = (category: string) => file.cases.filter((c) => c.category === category).length;
    console.log(`${file.cases.length} câu: ${[...CATEGORIES].map((category) => `${category} ${count(category)}`).join(', ')}.`);
    if (problems.length) {
      console.log(`Có ${problems.length} lỗi:`);
      for (const problem of problems) console.log(`- ${problem}`);
      process.exitCode = 1;
    } else console.log(partial ? 'Đúng định dạng.' : 'Đúng định dạng và đủ thành phần.');
  } catch (error) {
    console.error(`Không đọc được ${path}: ${error instanceof Error ? error.message : 'lỗi không rõ'}`);
    process.exitCode = 1;
  }
}
