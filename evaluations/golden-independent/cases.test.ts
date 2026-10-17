import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { knownResourceValues } from '../golden-v2/fixtures.js';
import type { GoldenCase } from '../golden-v2/scorer.js';
import { CLOCK, REQUIRED_CATEGORIES, TIME_ZONE, caseProblems, guideExamples, reservedPrompts, validateIndependentSet, type GoldenFile } from './validate.js';

const guide = readFileSync(new URL('./GUIDE.md', import.meta.url), 'utf8');
const registered = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')) as GoldenFile;
const examples = guideExamples(guide);
const example = (id: string) => structuredClone(examples.find((c) => c.id === id)!);
const none = new Set<string>();
const fileOf = (cases: GoldenCase[]): GoldenFile => ({ version: 1, clock: CLOCK, timeZone: TIME_ZONE, cases });
/** Six cases per required group from the guide's examples, alternating languages; prompts made unique. */
function completeSet(): GoldenCase[] {
  const sources = { single_step: 'vd-1', multi_step: 'vd-2', cross_service: 'vd-3', clarification: 'vd-4', refusal: 'vd-5' } as const;
  return REQUIRED_CATEGORIES.flatMap((category) => Array.from({ length: 6 }, (_, i) => ({
    ...example(sources[category]), id: `m${i + 1}-${category.replace('_', '-')}`, author: `member-${i + 1}`,
    language: i % 2 ? 'en' : 'vi', prompt: `${example(sources[category]).prompt} (bản ${i + 1})`,
  } as GoldenCase)));
}

const single = () => ({ ...example('vd-1'), id: 'm2-01', author: 'member-2', prompt: 'Thêm dòng "Đăng ký tên miền", "To Do" vào tab Tasks của bảng tính Frontend' }) as GoldenCase;
const cross = () => ({ ...example('vd-3'), id: 'm2-02', author: 'member-2', prompt: 'File a Jira ticket in Frontend about the broken cart and share its link with the Telegram group frontend' }) as GoldenCase;
const step = (c: GoldenCase, index = 0) => c.expect.steps![index]!;
const addLabel = (args: Record<string, unknown>) => ({ ...single(), services: ['github'], prompt: 'Gắn nhãn bug cho issue 42 của repo acme/web',
  expect: { kind: 'plan', steps: [{ tool: 'github.add_label', args: { repo: { equals: 'acme/web' }, label: { includesAny: ['bug'] }, ...args } }] } }) as GoldenCase;
const updateCard = (args: Record<string, unknown>) => ({ ...single(), services: ['trello'], prompt: 'Đóng card Lỗi đăng nhập Safari trên Trello',
  expect: { kind: 'plan', steps: [{ tool: 'trello.update_card', args: { cardId: { equals: 'card_fe_login' }, ...args } }] } }) as GoldenCase;

describe('registration file', () => {
  it('is well formed, and once cases are added the whole set must pass the full check', () => {
    expect(validateIndependentSet(registered, { complete: registered.cases.length > 0 })).toEqual([]);
  });
  it('fails the full check while it is empty, naming every missing part', () => {
    const problems = validateIndependentSet(fileOf([]), { complete: true });
    expect(problems).toContain('Bộ câu: cần ít nhất 30 câu, hiện có 0');
    for (const category of REQUIRED_CATEGORIES) expect(problems).toContain(`Bộ câu: nhóm ${category} cần ít nhất 4 câu, hiện có 0`);
    expect(problems).toContain('Bộ câu: cần ít nhất 5 câu tiếng Anh, hiện có 0');
  });
  it('rejects a file with another clock, time zone or version', () => {
    expect(validateIndependentSet({ ...fileOf([]), clock: '2026-10-20T10:00:00+07:00', timeZone: 'UTC', version: 2 }))
      .toEqual(expect.arrayContaining([expect.stringMatching(/clock/), expect.stringMatching(/timeZone/), expect.stringMatching(/version/)]));
  });
});

describe('guide', () => {
  it('has worked examples for the five groups, and each passes the case checks', () => {
    expect(new Set(examples.map((c) => c.category))).toEqual(new Set(REQUIRED_CATEGORIES));
    // The only problem an example has is its "vd-" id, which keeps it from being submitted.
    for (const c of examples) expect(caseProblems(c, none), c.id).toEqual([`${c.id}: "id" bắt đầu bằng "vd-" là ví dụ của GUIDE.md, không nộp`]);
    expect(examples.some((c) => c.expect.anyOf) && examples.some((c) => JSON.stringify(c).includes('refTo'))).toBe(true);
  });
  it('lists every write tool and every fixture ID that a write tool accepts', () => {
    for (const tool of ALL_TOOLS.filter((t) => t.sideEffect === 'write')) {
      expect(guide, tool.name).toContain(`\`${tool.name}\``);
      for (const property of Object.values(tool.inputSchema.properties as Record<string, Record<string, any>>)) {
        if (!property['x-resource']) continue;
        for (const value of knownResourceValues(property['x-resource'], property['x-resource-field'])) expect(guide, `${tool.name} ${value}`).toContain(value);
      }
    }
  });
});

describe('complete set', () => {
  it('accepts thirty cases spread over the five groups and both languages', () => {
    expect(validateIndependentSet(fileOf(completeSet()), { complete: true, reserved: none })).toEqual([]);
  });
  it('needs four cases in every group and five in each language; read_only does not count', () => {
    const cases = completeSet().filter((c) => !(c.category === 'refusal' && Number(c.author!.split('-')[1]) > 3))
      .map((c): GoldenCase => ({ ...c, language: 'vi' }));
    cases.push({ ...example('vd-4'), id: 'm9-read', category: 'read_only', services: ['trello'], prompt: 'Cho tôi xem các card trong list Doing của board Frontend', author: 'member-9' });
    const problems = validateIndependentSet(fileOf(cases), { complete: true, reserved: none });
    expect(problems).toContain('Bộ câu: nhóm refusal cần ít nhất 4 câu, hiện có 3');
    expect(problems).toContain('Bộ câu: cần ít nhất 5 câu tiếng Anh, hiện có 0');
    expect(problems).not.toContainEqual(expect.stringMatching(/m9-read/));
  });
  it('rejects duplicate ids and duplicate prompts within the set', () => {
    const [a, b] = completeSet();
    const problems = validateIndependentSet(fileOf([a!, { ...b!, id: a!.id, prompt: ` ${a!.prompt.toUpperCase()} ` }]), { reserved: none });
    expect(problems).toEqual(expect.arrayContaining([`${a!.id}: "id" bị trùng`, `${a!.id}: "prompt" trùng một câu khác trong bộ`]));
  });
});

describe('case checks', () => {
  it.each<[string, () => GoldenCase, RegExp]>([
    ['a name as author', () => ({ ...single(), author: 'Lan' }), /"author" phải là mã vai trò/],
    ['the earlier writer', () => ({ ...single(), author: 'author-v2' }), /author-v2/],
    ['an unknown tool', () => { const c = single(); step(c).tool = 'sheets.delete_row'; return c; }, /không có tool "sheets.delete_row"/],
    ['a read tool as a plan step', () => { const c = single(); step(c).tool = 'sheets.read_range'; step(c).args = { spreadsheetId: { equals: 'spreadsheet_frontend_2026' } }; return c; }, /tool đọc/],
    ['an argument the tool does not take', () => { const c = single(); step(c).args!.tab = { equals: 'Tasks' }; return c; }, /không có tham số "tab"/],
    ['an unknown condition', () => { const c = single(); step(c).args!.sheet = { is: 'Tasks' } as never; return c; }, /không có loại điều kiện "is"/],
    ['an ID outside the fixture workspace', () => { const c = single(); step(c).args!.spreadsheetId = { equals: 'spreadsheet_sales' }; return c; }, /spreadsheet_sales.*workspace giả lập/],
    ['a bad ID nested in anyOf', () => { const c = cross(); step(c, 1).args!.chatId = { anyOf: [{ equals: '-1001234567890' }, { equals: '-100999' }] }; return c; }, /chatId\.anyOf\[1\].*-100999/],
    ['refTo a tool missing from the alternative', () => { const c = cross(); step(c, 1).args!.text = { refTo: 'github.create_issue' }; return c; }, /refTo.*github.create_issue/],
    ['a time without offset', () => { const c = single(); step(c).args!.rows = { instantEquals: '2026-09-30T15:00:00' }; return c; }, /instantEquals/],
    ['a step on a service not listed', () => ({ ...cross(), services: ['jira'] }), /telegram.send_message thuộc dịch vụ telegram/],
    ['an unknown service', () => ({ ...single(), services: ['sheets', 'gmail'] }), /không có dịch vụ "gmail"/],
    ['steps on a clarification', () => ({ ...single(), category: 'clarification' }), /không có bước/],
    ['the wrong kind for the group', () => ({ ...single(), expect: { kind: 'refusal' } }), /nhóm single_step cần "plan"/],
    ['two steps in single_step', () => { const c = single(); c.expect.steps!.push(structuredClone(step(c))); return c; }, /đúng một bước/],
    ['cross_service on one service', () => ({ ...single(), category: 'cross_service' }), /ít nhất hai dịch vụ/],
    ['multi_step across services', () => ({ ...cross(), category: 'multi_step' }), /thuộc nhóm cross_service/],
    ['multi_step with only one-step alternatives', () => ({ ...single(), category: 'multi_step' }), /ít nhất một phương án có từ hai bước/],
    ['both steps and anyOf', () => { const c = single(); c.expect.anyOf = [c.expect.steps!]; return c; }, /đúng một trong hai/],
    ['a step without conditions', () => { const c = single(); step(c).args = {}; return c; }, /ít nhất một điều kiện/],
    ['a field the set does not use', () => ({ ...single(), memory: { board: 'board_fe' } }), /không có trường "memory"/],
    ['an example id', () => ({ ...single(), id: 'vd-9' }), /ví dụ của GUIDE.md/],
    ['an id with capitals or accents', () => ({ ...single(), id: 'Câu 1' }), /"id" chỉ gồm/],
    ['an extra write tool that is a read tool', () => { const c = single(); c.expect.allowExtraTools = ['slack.search_channels']; return c; }, /không phải tool ghi/],
    // Conditions a correct, schema-valid plan can never meet; the scorer would fail the case on every run.
    ['equals true on a list argument', () => { const c = single(); step(c).args!.rows = { equals: true }; return c; }, /rows: "equals" là true\/false, nhưng tham số này nhận danh sách/],
    ['a text ID for a number argument', () => addLabel({ issueNumber: { equals: '42' } }), /issueNumber: "equals" là chữ, nhưng tham số này nhận số/],
    ['startsWith on a number argument', () => addLabel({ issueNumber: { startsWith: '4' } }), /issueNumber: "startsWith" chỉ dùng cho tham số chữ/],
    ['minItems on a text argument', () => { const c = cross(); step(c).args!.summary = { minItems: 1 }; return c; }, /summary: "minItems" chỉ dùng cho tham số danh sách/],
    ['includesAny on a true/false argument', () => updateCard({ closed: { includesAny: ['đóng'] } }), /closed: "includesAny" chỉ dùng cho tham số chữ hoặc danh sách/],
    ['contains a text item in a list of rows', () => { const c = single(); step(c).args!.rows = { contains: 'Doing' }; return c; }, /rows: "contains" là chữ, nhưng mỗi phần tử của tham số này là danh sách/],
    ['a wrong type nested in anyOf', () => { const c = single(); step(c).args!.rows = { anyOf: [{ minItems: 1 }, { equals: 'Doing' }] }; return c; }, /rows\.anyOf\[1\]: "equals" là chữ/],
    ['an empty services list on a plan', () => ({ ...single(), services: [] }), /"services" phải liệt kê/],
  ])('rejects %s', (_label, build, message) => {
    const problems = caseProblems(build(), none);
    expect(problems.some((problem) => message.test(problem)), problems.join('\n')).toBe(true);
  });
  it('rejects prompts reused from the earlier sets or the guide, ignoring case and spacing', () => {
    const reserved = reservedPrompts();
    const earlier = JSON.parse(readFileSync(new URL('../golden-v2/cases-services.json', import.meta.url), 'utf8')).cases[0].prompt as string;
    expect(caseProblems({ ...single(), prompt: `  ${earlier.toUpperCase()}` }, reserved)).toContainEqual(expect.stringMatching(/trùng một câu của bộ cũ/));
    expect(caseProblems({ ...single(), prompt: example('vd-1').prompt }, reserved)).toContainEqual(expect.stringMatching(/ví dụ trong GUIDE.md/));
    expect(caseProblems(single(), reserved)).toEqual([]);
  });
  it('accepts conditions that fit the argument type', () => {
    expect(caseProblems(addLabel({ issueNumber: { equals: 42 } }), none)).toEqual([]);
    expect(caseProblems(updateCard({ closed: { equals: true }, title: { anyOf: [{ includesAny: ['safari'] }, { refTo: 'trello.update_card' }] } }), none)).toEqual([]);
  });
  it('accepts an empty services list for a refusal or clarification that names no supported service', () => {
    const refusal = { ...example('vd-5'), id: 'm2-09', author: 'member-2', services: [], prompt: 'Gửi email cho cả nhóm báo lịch nghỉ lễ sắp tới' } as GoldenCase;
    expect(caseProblems(refusal, none)).toEqual([]);
    expect(caseProblems({ ...refusal, category: 'clarification', expect: { kind: 'clarification' } }, none)).toEqual([]);
    expect(caseProblems({ ...refusal, services: undefined }, none)).toContainEqual(expect.stringMatching(/"services"/));
  });
  it('accepts an ID the user typed even when the workspace does not have it', () => {
    const c = single();
    c.prompt = 'Thêm dòng "Kiểm kho", "To Do" vào tab Tasks của bảng tính spreadsheet_sales';
    step(c).args!.spreadsheetId = { equals: 'spreadsheet_sales' };
    expect(caseProblems(c, none)).toEqual([]);
  });
});

describe('command line', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'evaluations/golden-independent/validate.ts', ...args], { encoding: 'utf8' });
  it('fails on the registration file until the full set is there', () => {
    const result = run();
    if (registered.cases.length > 0) return expect(result.status).toBe(0);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Bộ câu: cần ít nhất 30 câu, hiện có 0');
  });
  it('checks a writer file of bare cases with --partial', () => {
    const dir = mkdtempSync(join(tmpdir(), 'w401-'));
    try {
      const good = join(dir, 'member-2.json'), bad = join(dir, 'member-3.json');
      writeFileSync(good, JSON.stringify([single()]));
      writeFileSync(bad, JSON.stringify([{ ...single(), author: 'Lan' }]));
      const ok = run(good, '--partial');
      expect([ok.status, ok.stdout]).toEqual([0, expect.stringContaining('Đúng định dạng.')]);
      const failed = run(bad, '--partial');
      expect([failed.status, failed.stdout]).toEqual([1, expect.stringContaining('m2-01: "author" phải là mã vai trò')]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
