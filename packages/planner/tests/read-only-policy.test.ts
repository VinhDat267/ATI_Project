import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider, WorkingMemory, validatePlan } from '../src/index.js';

const historical = JSON.parse(readFileSync(new URL('../../../docs/ai-evidence/V3-GOLDEN-V2/services-llm-2026-10-03T11-10-25-012Z/report.json', import.meta.url), 'utf8'));
const cases = JSON.parse(readFileSync(new URL('../../../evaluations/golden-v2/cases-services.json', import.meta.url), 'utf8')).cases;
const regression = [[1, 'sh07'], [3, 'sh07'], [1, 'ca01']] as const;
describe('05/10 read-only policy', () => {
  it.each(regression)('rejects the exact W3-06 plan from run %s case %s before grounding', (run, id) => {
    const response = historical.results.find((r: any) => r.run === run).cases.find((c: any) => c.id === id).response;
    expect(validatePlan(JSON.stringify(response), ALL_TOOLS, { grounding: { memory: {}, userTexts: [] } }))
      .toMatchObject({ valid: false, layer: 'semantic', code: 'READ_ONLY_PLAN' });
  });
  for (const searchMode of ['llm', 'regex'] as const) {
    it.each(regression)(`${searchMode}: turns run %s case %s into a question without a repair call`, async (run, id) => {
      const response = historical.results.find((r: any) => r.run === run).cases.find((c: any) => c.id === id).response;
      const provider = new MockLLMProvider(); provider.setPlanResponses([response]);
      const planner = new AIPlanner({ provider, toolCatalog: ALL_TOOLS, searchMode, requireGroundedResources: false });
      const result = await planner.processMessage({ userMessage: searchMode === 'llm' ? cases.find((c: any) => c.id === id).prompt : 'Read Google Sheets and Google Calendar', memory: new WorkingMemory() });
      expect(result.kind).toBe('clarification');
      if (result.kind === 'clarification') {
        expect(result.question).toMatch(/Bạn muốn.*dữ liệu/);
        expect(result.reason).toBe('read_only');
      }
      expect(provider.getCallCount()).toBe(1);
    });
  }
  it('clarifies in one model call without model-opened search rounds, allowing directory prefetch', async () => {
    const provider = new MockLLMProvider(); provider.setPlanResponses([{ kind: 'clarification', question: 'Bạn muốn ghi dữ liệu ở đâu?' }]);
    const searches: string[] = [];
    const phases: string[] = [];
    const result = await new AIPlanner({ provider, toolCatalog: ALL_TOOLS, searchMode: 'llm',
      gatherSearch: async request => { searches.push(request.tool); return []; } })
      .processMessage({ userMessage: 'Xem các sự kiện trên Google Calendar', memory: new WorkingMemory(), onTiming: timing => phases.push(timing.phase) });
    expect(result.kind).toBe('clarification'); expect(provider.getCallCount()).toBe(1);
    expect(phases.filter(phase => phase === 'search')).toEqual([]);
    expect(phases).toContain('prefetch');
    expect(searches).toContain('calendar.list_calendars');
  });
  it('keeps a mixed read/write plan valid and does not spend a repair call', async () => {
    const response = { kind: 'plan', thinking: 'Read and send', summary: 'Send rows', warnings: [], steps: [
      { id: 'read', tool: 'sheets.read_range', description: 'Read cells', args: { spreadsheetId: 'spreadsheet_frontend_2026', range: 'Tasks!A1:B2' }, dependsOn: [] },
      { id: 'send', tool: 'slack.send_message', description: 'Send data', args: { channel: 'C_FRONTEND', text: 'Rows ready' }, dependsOn: ['read'] },
    ] };
    expect(validatePlan(JSON.stringify(response), ALL_TOOLS).valid).toBe(true);
    const provider = new MockLLMProvider(); provider.setPlanResponses([response]);
    const result = await new AIPlanner({ provider, toolCatalog: ALL_TOOLS, searchMode: 'llm', requireGroundedResources: false })
      .processMessage({ userMessage: 'Đọc Google Sheets rồi gửi Slack', memory: new WorkingMemory() });
    expect(result).toEqual(response); expect(provider.getCallCount()).toBe(1);
  });
});
