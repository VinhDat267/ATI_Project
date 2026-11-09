import { describe, expect, it } from 'vitest';
import {
  isSheetsDigestConfigV2,
  type ScheduleProposalMetadata,
  type ScheduleRunDeliveryResolution,
  type ScheduleRunView,
  type SheetsDigestCandidate,
  type SheetsDigestConfig,
  type SheetsDigestConfigV1,
  type SheetsDigestConfigV2,
  type SheetsDigestDataScope,
  type SheetsDigestDelivery,
  type SheetsDigestDestinationConfigV2,
  type SheetsDigestManualResolution,
  type SheetsDigestPreviewInfo,
  type SheetsDigestSourceConfigV2,
  type SheetsDigestWorkspaceMode,
} from '../src/index.js';

describe('SheetsDigestConfigV2 & Gate A recovery schema contracts', () => {
  it('accepts valid Personal mysheets -> gmail v2 config with distinct senderEmail and recipientEmail', () => {
    const config: SheetsDigestConfigV2 = {
      version: 2,
      workspaceMode: 'personal',
      workspaceId: null,
      source: {
        service: 'mysheets',
        credentialId: 'cred-mysheets-1',
        email: 'alice@gmail.com',
        spreadsheetId: 'sheet-123',
        spreadsheetTitle: 'Q4 Revenue',
        sheetName: 'Transactions',
        range: 'A1:F50',
        tailRows: 25,
      },
      destination: {
        service: 'gmail',
        credentialId: 'cred-gmail-1',
        senderEmail: 'alice@gmail.com',
        recipientEmail: 'finance@company.com',
      },
      focus: 'Doanh thu theo khu vực',
      includeAiSummary: true,
    };

    expect(isSheetsDigestConfigV2(config)).toBe(true);
  });

  it('accepts valid Personal mysheets -> telegram v2 config', () => {
    const config: SheetsDigestConfigV2 = {
      version: 2,
      workspaceMode: 'personal',
      workspaceId: null,
      source: {
        service: 'mysheets',
        credentialId: 'cred-mysheets-1',
        spreadsheetId: 'sheet-123',
        spreadsheetTitle: 'Daily Leads',
        tailRows: 20,
      },
      destination: {
        service: 'telegram',
        credentialId: 'cred-tg-1',
        chatId: '-100987654321',
        chatLabel: 'Sales Ops',
      },
      includeAiSummary: false,
    };

    expect(isSheetsDigestConfigV2(config)).toBe(true);
  });

  it('accepts valid Organization sheets -> slack and Hybrid mysheets -> slack v2 configs with non-null workspaceId', () => {
    const orgSharedConfig: SheetsDigestConfigV2 = {
      version: 2,
      workspaceMode: 'organization',
      workspaceId: 'ws-acme-01',
      source: {
        service: 'sheets',
        credentialId: 'cred-org-sheets-1',
        spreadsheetId: 'sheet-org-1',
        spreadsheetTitle: 'Org KPIs',
        tailRows: 30,
      },
      destination: {
        service: 'slack',
        credentialId: 'cred-org-slack-1',
        channelId: 'C01234567',
        channelLabel: '#kpi-daily',
      },
      includeAiSummary: true,
    };

    const orgHybridConfig: SheetsDigestConfigV2 = {
      ...orgSharedConfig,
      source: {
        ...orgSharedConfig.source,
        service: 'mysheets',
        credentialId: 'cred-personal-sheets-9',
        email: 'owner@acme.com',
      },
    };

    expect(isSheetsDigestConfigV2(orgSharedConfig)).toBe(true);
    expect(isSheetsDigestConfigV2(orgHybridConfig)).toBe(true);
  });

  it('accepts valid Legacy sheets -> slack v2 config with workspaceId: null', () => {
    const legacyConfig: SheetsDigestConfigV2 = {
      version: 2,
      workspaceMode: 'legacy',
      workspaceId: null,
      source: {
        service: 'sheets',
        credentialId: 'cred-legacy-sheets',
        spreadsheetId: 'sheet-legacy-1',
        spreadsheetTitle: 'Legacy Sheet',
        tailRows: 10,
      },
      destination: {
        service: 'slack',
        credentialId: 'cred-legacy-slack',
        channelId: 'C999999',
      },
      includeAiSummary: false,
    };

    expect(isSheetsDigestConfigV2(legacyConfig)).toBe(true);
  });

  it('rejects SheetsDigestConfigV1 (version: 1) in isSheetsDigestConfigV2 while keeping SheetsDigestConfig union compatible', () => {
    const v1Config: SheetsDigestConfigV1 = {
      version: 1,
      source: {
        service: 'mysheets',
        credentialId: 'cred-1',
        spreadsheetId: 'sheet-1',
        spreadsheetTitle: 'Legacy Digest',
        tailRows: 20,
      },
      destination: {
        service: 'slack',
        channelId: 'C12345',
      },
      includeAiSummary: true,
    };

    const unionConfig: SheetsDigestConfig = v1Config;
    expect(isSheetsDigestConfigV2(unionConfig)).toBe(false);
  });

  it('rejects missing or whitespace-only source.credentialId or destination.credentialId', () => {
    const base = {
      version: 2,
      workspaceMode: 'personal',
      workspaceId: null,
      source: {
        service: 'mysheets',
        credentialId: 'cred-source',
        spreadsheetId: 'sheet-123',
        spreadsheetTitle: 'Sheet',
        tailRows: 20,
      },
      destination: {
        service: 'slack',
        credentialId: 'cred-dest',
        channelId: 'C123',
      },
      includeAiSummary: true,
    };

    expect(
      isSheetsDigestConfigV2({
        ...base,
        source: { ...base.source, credentialId: '' },
      }),
    ).toBe(false);

    expect(
      isSheetsDigestConfigV2({
        ...base,
        source: { ...base.source, credentialId: '   ' },
      }),
    ).toBe(false);

    expect(
      isSheetsDigestConfigV2({
        ...base,
        destination: { ...base.destination, credentialId: '   ' },
      }),
    ).toBe(false);
  });

  it('rejects organization workspaceMode when workspaceId is null or empty, and rejects personal/legacy when workspaceId is non-null', () => {
    const base = {
      version: 2,
      workspaceMode: 'organization',
      workspaceId: null,
      source: {
        service: 'sheets',
        credentialId: 'cred-source',
        spreadsheetId: 'sheet-123',
        spreadsheetTitle: 'Sheet',
        tailRows: 20,
      },
      destination: {
        service: 'slack',
        credentialId: 'cred-dest',
        channelId: 'C123',
      },
      includeAiSummary: true,
    };

    expect(isSheetsDigestConfigV2(base)).toBe(false);
    expect(isSheetsDigestConfigV2({ ...base, workspaceId: '   ' })).toBe(false);
    expect(
      isSheetsDigestConfigV2({
        ...base,
        workspaceMode: 'personal',
        workspaceId: 'ws-should-not-be-set',
      }),
    ).toBe(false);
    expect(
      isSheetsDigestConfigV2({
        ...base,
        workspaceMode: 'legacy',
        workspaceId: 'ws-should-not-be-set',
      }),
    ).toBe(false);
  });

  it('rejects gmail destination with invalid recipientEmail or invalid senderEmail', () => {
    const base = {
      version: 2,
      workspaceMode: 'personal',
      workspaceId: null,
      source: {
        service: 'mysheets',
        credentialId: 'cred-source',
        spreadsheetId: 'sheet-123',
        spreadsheetTitle: 'Sheet',
        tailRows: 20,
      },
      destination: {
        service: 'gmail',
        credentialId: 'cred-gmail',
        recipientEmail: 'not-an-email',
      },
      includeAiSummary: true,
    };

    expect(isSheetsDigestConfigV2(base)).toBe(false);
    expect(
      isSheetsDigestConfigV2({
        ...base,
        destination: {
          service: 'gmail',
          credentialId: 'cred-gmail',
          recipientEmail: 'valid@company.com',
          senderEmail: 'invalid-sender',
        },
      }),
    ).toBe(false);
  });

  it('supports SheetsDigestPreviewInfo, SheetsDigestCandidate, SheetsDigestDelivery, ScheduleRunView recovery fields, and ScheduleProposalMetadata reauthorize fields', () => {
    const mode: SheetsDigestWorkspaceMode = 'organization';
    const scope: SheetsDigestDataScope = 'full_tab_verified';
    const resolution: ScheduleRunDeliveryResolution = 'confirmed_sent';
    const manualResolution: SheetsDigestManualResolution = {
      status: 'confirmed_sent',
      resolvedAt: '2026-11-08T08:05:00.000Z',
      resolvedBy: 'user-1',
    };

    const preview: SheetsDigestPreviewInfo = {
      workspaceMode: mode,
      workspaceName: 'Acme Corp',
      sourceConnectionLabel: 'Google Sheets cá nhân (alice@acme.com)',
      sourceOwnerLabel: 'alice@acme.com',
      spreadsheetTitle: 'Q4 Revenue',
      spreadsheetId: 'sheet-123',
      sheetName: 'Transactions',
      requestedRangeLabel: 'Transactions!A1:F50',
      destinationConnectionLabel: 'Slack tổ chức (Acme Corp)',
      destinationTargetLabel: '#finance-alerts',
      crossBoundaryWarning: 'Nguồn từ tài khoản cá nhân gửi sang kênh tổ chức.',
    };

    const candidate: SheetsDigestCandidate = {
      canAutoDigest: true,
      configHash: 'sha256:abc123',
      preview,
      requiresClarification: false,
    };

    const delivery: SheetsDigestDelivery = {
      destination: 'slack',
      targetId: 'C123',
      targetLabel: '#finance-alerts',
      spreadsheetId: 'sheet-123',
      spreadsheetTitle: 'Q4 Revenue',
      sheetName: 'Transactions',
      rowCount: 48,
      dataScope: scope,
      scannedRange: 'Transactions!A1:Z50',
      windowClipped: false,
      summaryMode: 'ai',
      sentAt: '2026-11-08T08:00:05.000Z',
      manualResolution,
    };

    const runView: ScheduleRunView = {
      id: 'run-1',
      scheduleId: 'sched-1',
      trigger: 'scheduled',
      dueAt: '2026-11-08T08:00:00.000Z',
      createdAt: '2026-11-08T08:00:01.000Z',
      state: 'digest_sent',
      missedCount: 0,
      convId: null,
      planId: null,
      planStatus: null,
      error: null,
      delivery,
      deliveryStartedAt: '2026-11-08T08:00:02.000Z',
      deliveryResolution: resolution,
      deliveryResolvedAt: '2026-11-08T08:05:00.000Z',
      deliveryFollowupRunId: null,
    };

    const proposalMeta: ScheduleProposalMetadata = {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'update',
        name: 'Báo cáo doanh thu Q4',
        request: 'Tóm tắt bảng Q4 Revenue gửi vào #finance-alerts',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi ngày lúc 08:00',
      },
      scheduleId: 'sched-1',
      baseVersion: 2,
      services: ['mysheets', 'slack'],
      nextRuns: ['2026-11-09T01:00:00.000Z'],
      previous: null,
      digestCandidate: candidate,
      reauthorize: true,
      expiresAt: '2026-11-09T08:00:00.000Z',
    };

    const sourceV2: SheetsDigestSourceConfigV2 = {
      service: 'mysheets',
      credentialId: 'cred-1',
      spreadsheetId: 'sheet-123',
      spreadsheetTitle: 'Q4 Revenue',
      tailRows: 20,
    };
    const destV2: SheetsDigestDestinationConfigV2 = {
      service: 'slack',
      credentialId: 'cred-2',
      channelId: 'C123',
    };

    expect(candidate.preview?.workspaceMode).toBe('organization');
    expect(runView.deliveryResolution).toBe('confirmed_sent');
    expect(proposalMeta.reauthorize).toBe(true);
    expect(sourceV2.credentialId).toBe('cred-1');
    expect(destV2.credentialId).toBe('cred-2');
  });
});
