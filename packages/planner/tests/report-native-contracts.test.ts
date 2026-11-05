import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { ALL_TOOLS, GITHUB_OAUTH_TOOLS, MYSHEETS_TOOLS, MYSHEETS_SERVICE, SERVICE_REGISTRY, type PlanResponse } from '@wap/tool-schemas';
import { GitHubAdapter, PersonalSheetsAdapter } from '@wap/tool-adapters';
import { AIPlanner, WorkingMemory, ReportArtifactStore, validatePlan } from '../src/index.js';
import { renderGithubPrsReport, renderSheetSummaryReport } from '../src/reports/renderers.js';

const tools = [...new Map([...ALL_TOOLS, ...GITHUB_OAUTH_TOOLS, ...MYSHEETS_TOOLS].map(t => [t.name, t])).values()];
const forged: PlanResponse = { kind: 'plan', summary: 'Gửi cập nhật PR', thinking: 'Notify dev', warnings: [], steps: [{ id: 'post', tool: 'slack.send_message', description: 'Gửi kết quả', args: { channel: 'C_DEV', text: 'Hiện có 999 PR: #999' }, dependsOn: [] }] };
function memory() {
  const m = new WorkingMemory();
  m.setEntity('workflow_resource_defaults', { github: { repo: 'acme/web' }, slack: { channelId: 'C_DEV', channelName: 'dev' }, mysheets: { spreadsheetId: 'spreadsheet_fixture_review277', sheetName: 'Tasks' } });
  m.setEntity('channel', [{ id: 'C_DEV', name: 'dev' }, { id: 'C_OPS', name: 'ops' }]);
  return m;
}
describe('PR277 report regressions with native adapter outputs', () => {
  let server: Server, base: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url?.startsWith('/v4/') ? { range: 'Tasks!A1:B3', values: [['Status', 'Revenue'], ['Done', 120], ['To Do', 80]] } : [{ id: 41, number: 41, title: 'Actual PR', html_url: 'https://github.com/acme/web/pull/41', state: 'open', user: { login: 'dev' } }]));
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + (server.address() as any).port;
  });
  afterAll(() => new Promise<void>(r => server.close(() => r())));
  it.each([
    'Cho tôi danh sách PR đang mở trên GitHub acme/web rồi nhắn kết quả vào Slack #dev',
    'Summarize open pull requests on GitHub acme/web and send the report to Slack #dev',
    'Repo acme/web đang có mấy PR mở? Nhắn Slack #dev giúp tôi.',
    'Đếm PR đang mở trên GitHub acme/web rồi gửi Slack #dev',
    'Which GitHub pull requests need review? Post the result to Slack #dev',
  ])('rejects an unverified factual message for original request: %s', (request) => {
    const result = validatePlan(JSON.stringify(forged), tools, { grounding: { memory: memory().toJSON().entities ?? memory().toJSON(), userTexts: [request] } });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.layer).toBe('grounding');
  });
  it('preserves a quoted user-authored message even after an earlier report request', () => {
    const literal = { ...forged, steps: [{ ...forged.steps[0]!, args: { channel: 'C_DEV', text: 'Báo cáo PR: hiện có 999 PR #999' } }] };
    expect(validatePlan(JSON.stringify(literal), tools, { grounding: { memory: { channel: { id: 'C_DEV', name: 'dev' } }, userTexts: ['Báo cáo PR hôm qua', 'Gửi Slack #dev nguyên văn "Báo cáo PR: hiện có 999 PR #999"'] } }).valid).toBe(true);
  });
  it('renders the canonical url returned by the real GitHub adapter', async () => {
    const adapter = new GitHubAdapter({ credentials: { token: 'fixture' }, allowedScope: { repos: ['acme/web'] }, baseUrl: base });
    const prs = await adapter.execute('github.list_pull_requests', { repo: 'acme/web', state: 'open' });
    const report = renderGithubPrsReport(prs as any);
    expect(report.text).toContain('https://github.com/acme/web/pull/41');
    expect(report.text).not.toContain('undefined');
  });
  it('grounds every destination from the native PR observation', async () => {
    const adapter = new GitHubAdapter({ credentials: { token: 'fixture' }, allowedScope: { repos: ['acme/web'] }, baseUrl: base });
    const draft = { ...forged, summary: 'Báo cáo PR', steps: [{ id: 'read', tool: 'github.list_pull_requests', description: 'Đọc PR', args: { repo: 'acme/web', state: 'open' }, dependsOn: [] }, { ...forged.steps[0]!, id: 'dev', dependsOn: ['read'] }, { ...forged.steps[0]!, id: 'ops', args: { channel: 'C_OPS', text: '999 PR #999' }, dependsOn: ['read'] }] };
    const planner = new AIPlanner({ toolCatalog: tools, searchMode: 'llm', prefetchDirectory: false, reportEvidenceStore: new ReportArtifactStore(), gatherSearch: async ({ tool, args }) => tool === 'github.list_pull_requests' ? adapter.execute(tool, args) : [], provider: { name: 'controlled-adverse-response', generatePlan: async () => JSON.stringify(draft) } });
    const result = await planner.processMessage({ userMessage: 'Báo cáo PR GitHub acme/web vào Slack #dev và #ops', memory: memory(), actor: { userId: 'review-user' } });
    expect(result.kind).toBe('plan');
    if (result.kind === 'plan') {
      for (const step of result.steps.filter(s => s.tool === 'slack.send_message')) {
        expect(step.args.text).toContain('#41: Actual PR');
        expect(step.args.text).not.toContain('999');
      }
    }
  });
  it('clarifies report plus literal destinations rather than guessing which body to overwrite', async () => {
    const literal = 'Đang tổng hợp, vui lòng chờ';
    const adapter = new GitHubAdapter({ credentials: { token: 'fixture' }, allowedScope: { repos: ['acme/web'] }, baseUrl: base });
    const draft = {
      ...forged, steps: [
        { id: 'read', tool: 'github.list_pull_requests', description: 'Đọc PR', args: { repo: 'acme/web', state: 'open' }, dependsOn: [] },
        { ...forged.steps[0]!, id: 'report', dependsOn: ['read'] },
        { ...forged.steps[0]!, id: 'literal', args: { channel: 'C_OPS', text: literal } },
      ]
    };
    const planner = new AIPlanner({ toolCatalog: tools, searchMode: 'llm', prefetchDirectory: false, gatherSearch: async ({ tool, args }) => tool === 'github.list_pull_requests' ? adapter.execute(tool, args) : [], provider: { name: 'controlled', generatePlan: async () => JSON.stringify(draft) } });
    const result = await planner.processMessage({ userMessage: 'Lấy danh sách PR GitHub acme/web rồi gửi báo cáo Slack #dev; đồng thời nhắn Slack #ops nguyên văn "Đang tổng hợp, vui lòng chờ"', memory: memory(), actor: { userId: 'review-user' } });
    expect(result.kind).toBe('clarification');
  });
  it('does not let one quoted literal exempt every required report destination', () => {
    const plan = { ...forged, steps: [forged.steps[0]!, { ...forged.steps[0]!, id: 'second', args: { channel: 'C_OPS', text: 'Hiện có 999 PR: #999' } }] };
    const request = 'Báo cáo PR GitHub vào Slack #dev và gửi #ops nguyên văn "Hiện có 999 PR: #999"';
    expect(validatePlan(JSON.stringify(plan), tools, { grounding: { memory: { channel: [{ id: 'C_DEV', name: 'dev' }, { id: 'C_OPS', name: 'ops' }] }, userTexts: [request] } }).valid).toBe(false);
  });
  it('lets schema validation retry a malformed model step instead of crashing the binder', async () => {
    let calls = 0;
    const corrected = { kind: 'clarification', question: 'Bạn muốn gửi vào kênh nào?', context: 'Thiếu đích' };
    const planner = new AIPlanner({ toolCatalog: tools, searchMode: 'llm', prefetchDirectory: false, provider: { name: 'controlled', generatePlan: async () => JSON.stringify(++calls === 1 ? { ...forged, steps: [null, ...forged.steps] } : corrected) } });
    const result = await planner.processMessage({ userMessage: 'Báo cáo PR GitHub vào Slack', memory: memory() });
    expect(result.kind).toBe('clarification'); expect(calls).toBe(2);
  });
  it('asks before using an unrelated issue body as report content', async () => {
    const adapter = new GitHubAdapter({ credentials: { token: 'fixture' }, allowedScope: { repos: ['acme/web'] }, baseUrl: base });
    const draft = {
      ...forged, steps: [
        { id: 'read', tool: 'github.list_pull_requests', description: 'Read', args: { repo: 'acme/web', state: 'open' }, dependsOn: [] },
        { id: 'issue', tool: 'github.create_issue', description: 'Create separate issue', args: { repo: 'acme/web', title: 'Review', body: 'Please triage this separately' }, dependsOn: [] },
        { ...forged.steps[0]!, dependsOn: ['read'] },
      ]
    };
    const planner = new AIPlanner({ toolCatalog: tools, searchMode: 'llm', prefetchDirectory: false, gatherSearch: async ({ tool, args }) => tool === 'github.list_pull_requests' ? adapter.execute(tool, args) : [], provider: { name: 'controlled', generatePlan: async () => JSON.stringify(draft) } });
    const result = await planner.processMessage({ userMessage: 'Báo cáo PR GitHub acme/web vào Slack #dev và tạo issue riêng với nội dung Please triage this separately', memory: memory() });
    expect(result.kind).toBe('clarification');
  });
  it('rejects populated headerless Sheets data instead of certifying an empty sheet', async () => {
    const adapter = new PersonalSheetsAdapter({ userId: 'review-user', tokens: { getAccessToken: async () => 'fixture' }, allowedScope: { spreadsheets: ['spreadsheet_fixture_review277'] }, apiBaseUrl: base });
    const raw = await adapter.execute('mysheets.read_range', { spreadsheetId: 'spreadsheet_fixture_review277', range: 'Tasks!A1:B3' });
    expect(() => renderSheetSummaryReport(raw as any)).toThrow(/header/i);
    const aware = await adapter.execute('mysheets.read_range', { spreadsheetId: 'spreadsheet_fixture_review277', range: 'Tasks!A1:B3', headerAware: true });
    expect(renderSheetSummaryReport(aware as any, { groupBy: 'Status', metricColumn: 'Revenue' })).toMatchObject({ itemCount: 2, coverage: 'complete' });
    expect(renderSheetSummaryReport(aware as any, { metricColumn: 'Revenue' }).text).toContain('200');
  });
  it.each([false, true])('preserves the explicit Sheets header setting %s without dropping requested rows', async (headerAware) => {
    const adapter = new PersonalSheetsAdapter({ userId: 'review-user', tokens: { getAccessToken: async () => 'fixture' }, allowedScope: { spreadsheets: ['spreadsheet_fixture_review277'] }, apiBaseUrl: base });
    const draft = {
      ...forged, summary: 'Báo cáo Sheets', steps: [
        { id: 'read', tool: 'mysheets.read_range', description: 'Đọc bảng tính', args: { spreadsheetId: 'spreadsheet_fixture_review277', range: 'Tasks!A1:B3', headerAware }, dependsOn: [] },
        { ...forged.steps[0]!, dependsOn: ['read'] },
      ]
    };
    const planner = new AIPlanner({ toolCatalog: tools, serviceRegistry: [...SERVICE_REGISTRY, MYSHEETS_SERVICE], searchMode: 'llm', prefetchDirectory: false, gatherSearch: async ({ tool, args }) => tool === 'mysheets.read_range' ? adapter.execute(tool, args) : [], provider: { name: 'controlled-adverse-response', generatePlan: async () => JSON.stringify(draft) } });
    const result = await planner.processMessage({ userMessage: 'Tổng hợp số liệu Google Sheets spreadsheet_fixture_review277 range Tasks!A1:B3 rồi gửi vào Slack #dev', memory: memory(), actor: { userId: 'review-user' } });
    expect(result.kind).toBe(headerAware ? 'plan' : 'clarification');
    if (result.kind === 'plan') {
      expect(result.reportEvidence?.itemCount).toBe(2);
      expect(result.steps.find(s => s.tool === 'slack.send_message')?.args.text).toContain('Tổng số dòng đã đối chiếu: 2');
    }
  });
  it('does not reinterpret a headerless A2 range as a one-row complete report', async () => {
    const rangeServer = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ range: 'Tasks!A2:B3', values: [['Done', 120], ['To Do', 80]] })); });
    await new Promise<void>(r => rangeServer.listen(0, '127.0.0.1', r));
    try {
      const adapter = new PersonalSheetsAdapter({ userId: 'review-user', tokens: { getAccessToken: async () => 'fixture' }, allowedScope: { spreadsheets: ['spreadsheet_fixture_review277'] }, apiBaseUrl: 'http://127.0.0.1:' + (rangeServer.address() as any).port });
      const draft = { ...forged, steps: [{ id: 'read', tool: 'mysheets.read_range', description: 'Read', args: { spreadsheetId: 'spreadsheet_fixture_review277', range: 'Tasks!A2:B3' }, dependsOn: [] }, ...forged.steps] };
      const planner = new AIPlanner({ toolCatalog: tools, serviceRegistry: [...SERVICE_REGISTRY, MYSHEETS_SERVICE], searchMode: 'llm', prefetchDirectory: false, gatherSearch: async ({ tool, args }) => tool === 'mysheets.read_range' ? adapter.execute(tool, args) : [], provider: { name: 'controlled', generatePlan: async () => JSON.stringify(draft) } });
      const result = await planner.processMessage({ userMessage: 'Tổng hợp bảng tính Google Sheets spreadsheet_fixture_review277 vùng Tasks!A2:B3 rồi gửi Slack #dev', memory: memory() });
      expect(result.kind).toBe('clarification');
    } finally { await new Promise<void>(r => rangeServer.close(() => r())); }
  });
});
