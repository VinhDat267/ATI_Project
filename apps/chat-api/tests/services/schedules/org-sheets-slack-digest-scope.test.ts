import { describe, expect, it, vi } from 'vitest';
import { StepError } from '@wap/tool-adapters';
import type { ScheduleResponse, SlackDigestConfig } from '@wap/tool-schemas';
import { computeSlackDigestConfigHash, evaluateSlackDigestCandidate } from '../../../src/services/schedules/slack-digest-candidate.js';
import { SlackDigestRunner } from '../../../src/services/schedules/slack-digest-runner.js';

const ROADMAP = { id: 'roadmap_spreadsheet_fixture', title: 'Roadmap' };
const SPRINT = { id: 'sprint_spreadsheet_fixture', title: 'Sprint' };
const request = 'Tổng hợp bảng tính Sprint tab Backlog A1:C10 và lịch nhóm, gửi Slack #team.';
const proposal: ScheduleResponse = {
  kind: 'schedule', action: 'create', name: 'Team digest', request,
  recurrence: { type: 'daily', time: '09:00' }, summary: 'Team digest',
};
const scope = {
  userId: 'user-fixture', workspaceMode: 'organization' as const, workspaceId: 'workspace-fixture',
};
const approvedArgs = { spreadsheetId: SPRINT.id, sheetId: 7, range: 'Backlog!A1:C10' };

function setup() {
  const slack = vi.fn(async (tool: string, _args?: Record<string, unknown>) => tool === 'slack.search_channels'
    ? [{ id: 'C_TEAM', name: 'team' }] : { ts: '1700000000.000001' });
  const sheets = vi.fn(async (tool: string, args?: Record<string, unknown>) => {
    if (tool === 'sheets.list_spreadsheets') return [ROADMAP, SPRINT].filter((sheet) =>
      args?.spreadsheetId ? sheet.id === args.spreadsheetId : sheet.title === args?.query
    );
    if (tool === 'sheets.list_sheets') {
      return [
        { id: 0, title: 'Overview', spreadsheetId: SPRINT.id },
        { id: 7, title: 'Backlog', spreadsheetId: SPRINT.id },
      ];
    }
    return { range: 'Backlog!A1:C10', values: [['Task', 'Status'], ['Sprint task', 'Pending']] };
  });
  const getAdapter = vi.fn(async (service: string) => {
    if (service === 'slack') return { execute: slack };
    if (service === 'sheets') return { execute: sheets };
    if (service === 'calendar') return { execute: async () => [] };
    throw new Error('Unexpected service ' + service);
  });
  const candidate = (overrides: Partial<Parameters<typeof evaluateSlackDigestCandidate>[0]> = {}) =>
    evaluateSlackDigestCandidate({
      ...scope, proposal, services: ['sheets', 'calendar', 'slack'], slackCredentialId: 'slack-fixture',
      timeZone: 'Asia/Ho_Chi_Minh', getAdapter, ...overrides,
    });
  const runner = new SlackDigestRunner({
    encryptionKey: 'fixture-key', timeZone: 'Asia/Ho_Chi_Minh',
    adapterFactory: { getAdapterForService: getAdapter },
    credentialRepo: { getPersonalCredentials: async () => null },
  });
  const run = (config: SlackDigestConfig, hash = computeSlackDigestConfigHash(config)) =>
    runner.execute({
      ...scope, scheduleId: 'schedule-fixture', scheduleVersion: 1, runId: 'run-fixture',
      name: proposal.name!, request, trigger: 'scheduled', services: ['sheets', 'calendar', 'slack'],
      dueAt: new Date('2026-11-18T02:00:00Z'), digestConfig: config, digestConfigHash: hash,
    }, new AbortController().signal);
  return { slack, sheets, candidate, run };
}

describe('pinned organization Sheets in a multi-source Slack digest', () => {
  it('previews and sends using the same named workbook, numeric tab ID and exact range', async () => {
    const { candidate, sheets, slack, run } = setup();
    const preview = await candidate();
    expect(preview.canAutoDigest, preview.disabledReason).toBe(true);
    expect(preview).toMatchObject({ canAutoDigest: true, config: { sources: [
      { service: 'sheets', tool: 'sheets.read_range', args: approvedArgs, label: 'Sprint · Backlog!A1:C10' },
      { service: 'calendar' },
    ] } });
    sheets.mockClear();
    await expect(run(preview.config!, preview.configHash)).resolves.toMatchObject({ status: 'digest_sent' });
    expect(sheets.mock.calls.map(([tool]) => tool)).toEqual(['sheets.read_range']);
    expect(sheets).toHaveBeenCalledWith('sheets.read_range', expect.objectContaining(approvedArgs), expect.anything());
    expect(slack).toHaveBeenCalledWith('slack.send_message', expect.objectContaining({ text: expect.stringContaining('Sprint task') }), expect.anything());
  });

  it.each([
    'Tổng hợp bảng tính Missing tab Backlog A1:C10 và lịch nhóm, gửi Slack #team.',
    'Tổng hợp bảng tính và lịch nhóm, gửi Slack #team.',
    'Tổng hợp bảng tính Sprint vùng A1:C10 và lịch nhóm, gửi Slack #team.',
    'Tổng hợp bảng tính Sprint tab Overview Backlog!A1:C10 và lịch nhóm, gửi Slack #team.',
    'Tổng hợp bảng tính Sprint tab Backlog A1:C100 và lịch nhóm, gửi Slack #team.',
  ])('requires a unique approved scope for %s', async (text) => {
    const { candidate, sheets } = setup();
    await expect(candidate({ proposal: { ...proposal, request: text } }))
      .resolves.toMatchObject({ canAutoDigest: false, disabledReason: expect.any(String) });
    expect(sheets.mock.calls.map(([tool]) => tool)).not.toContain('sheets.read_range');
  });

  it.each(['B2', 'b2', 'A:A', 'a:a', 'B2 and range A1:C10'])('does not expand unsupported coordinates %s, even on an existing schedule', async (cells) => {
    const { candidate } = setup();
    const created = await candidate();
    await expect(candidate({
      proposal: { ...proposal, action: 'update', request: 'Report spreadsheet Sprint tab "Backlog" ' + cells + ', then send to Slack #team.' },
      existingDigest: created.config,
    })).resolves.toMatchObject({ canAutoDigest: false });
  });

  it('does not substitute another workbook when a requested workbook is unavailable', async () => {
    const { candidate, sheets } = setup();
    sheets.mockResolvedValueOnce([ROADMAP]).mockResolvedValueOnce([{ id: 7, title: 'Backlog', spreadsheetId: ROADMAP.id }]);
    await expect(candidate({
      proposal: { ...proposal, request: 'Report file Sprint (tab Backlog, range A1:C10) using Google Sheets, then send to Slack #team.' },
    })).resolves.toMatchObject({ canAutoDigest: false });
  });

  it('asks for one workbook when the request includes two possible workbook IDs', async () => {
    const { candidate } = setup();
    await expect(candidate({
      proposal: { ...proposal, request: 'Read Backlog!A1:C10 from ' + SPRINT.id + ' or ' + ROADMAP.id + ', send to Slack #team.' },
    })).resolves.toMatchObject({ canAutoDigest: false });
  });

  it('keeps the approved worksheet ID when reauthorizing after the tab was renamed', async () => {
    const { candidate, sheets } = setup();
    const created = await candidate();
    sheets.mockClear();
    const reauthorized = await candidate({
      proposal: { ...proposal, action: 'update', request: 'Report spreadsheet Sprint tab Overview!A1:C10, then send to Slack #team.' },
      existingDigest: created.config,
      reauthorizeOrgSheets: true,
    });
    expect(reauthorized.config?.sources[0]?.args).toEqual(approvedArgs);
    expect(sheets.mock.calls.map(([tool]) => tool)).toEqual(['sheets.read_range']);
  });

  it('includes the first selected row when the approved range starts below row 1', async () => {
    const { candidate, sheets, slack, run } = setup();
    const preview = await candidate({ proposal: { ...proposal, request: request.replace('A1:C10', 'B3:D5') } });
    sheets.mockResolvedValueOnce({ range: 'Backlog!B3:D5', values: [['Keep this task', 'Pending'], ['Second task', 'Done']] });
    await expect(run(preview.config!, preview.configHash)).resolves.toMatchObject({ status: 'digest_sent' });
    expect(slack).toHaveBeenCalledWith('slack.send_message', expect.objectContaining({ text: expect.stringContaining('Keep this task') }), expect.anything());
  });

  it('uses the requested user scope if the planner omits it', async () => {
    const { candidate } = setup();
    const preview = await candidate({
      proposal: { ...proposal, request: 'Tổng hợp bảng tính và lịch nhóm, gửi Slack #team.' },
      sheetsRequestText: request,
    });
    expect(preview.config?.sources[0]?.args).toEqual(approvedArgs);
  });

  it('preserves the previously approved scope when only recurrence changes', async () => {
    const { candidate } = setup();
    const created = await candidate();
    const updated = await candidate({
      proposal: { ...proposal, action: 'update', request: 'Tổng hợp bảng tính và lịch nhóm, gửi Slack #team.' },
      existingDigest: created.config,
    });
    expect(updated.config?.sources[0]?.args).toEqual(approvedArgs);
  });

  it('blocks a legacy unpinned schedule and a changed range with an old hash before reading or sending', async () => {
    const { candidate, run, sheets, slack } = setup();
    const { config, configHash } = await candidate();
    const otherSources = config!.sources.slice(1);
    const source = config!.sources[0]!;
    sheets.mockClear();
    slack.mockClear();
    await expect(run({ ...config!, sources: [{ ...source, args: undefined }, ...otherSources] }))
      .resolves.toMatchObject({ status: 'blocked', pauseSchedule: true });
    await expect(run({ ...config!, sources: [
      { ...source, args: { ...source.args, range: 'Backlog!A1:C20' } }, ...otherSources,
    ] }, configHash)).resolves.toMatchObject({ status: 'blocked', pauseSchedule: true });
    expect(sheets).not.toHaveBeenCalled();
    expect(slack).not.toHaveBeenCalled();
  });

  it('pauses without Slack delivery when the approved scope is revoked', async () => {
    const { candidate, run, sheets, slack } = setup();
    const { config } = await candidate();
    sheets.mockRejectedValueOnce(new StepError({ category: 'AUTH_ERROR', message: 'Sheets scope removed' }));
    slack.mockClear();
    await expect(run(config!)).resolves.toMatchObject({ status: 'blocked', pauseSchedule: true });
    expect(slack.mock.calls.map(([tool]) => tool)).not.toContain('slack.send_message');
  });
});
