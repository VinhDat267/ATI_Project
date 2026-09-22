import { assertPilotAccess, type PilotPolicy } from '../policy.js';
import { parseRequest, type SourceRow } from '../source.js';
import { evaluateChecklist, type ChecklistResult } from '../checklist.js';
import { sourceKey } from '../identity.js';
import { pilotFetch } from '../http-client.js';
import type { PilotConfig } from '../config.js';

export type ReadSheetsRequestParams = {
  config: PilotConfig;
  policy: PilotPolicy;
  principalId: string;
  spreadsheetId: string;
  tabId: string;
  requestId: string;
};

export type ReadSheetsRequestResult = {
  row: SourceRow;
  checklist: ChecklistResult;
  sourceKey: string;
  sourceRevision: string;
};

export async function readSheetsRequest(
  params: ReadSheetsRequestParams,
): Promise<ReadSheetsRequestResult> {
  const { config, policy, principalId, spreadsheetId, tabId, requestId } = params;

  // 1. Policy check (enforce allowlist)
  assertPilotAccess(policy, principalId, {
    kind: 'source',
    spreadsheetId,
    tabId,
  });

  // 2. Build URL and authorization
  const range = `${encodeURIComponent(tabId)}!A1:H101`;
  const encodedSpreadsheetId = encodeURIComponent(spreadsheetId);
  let url = `https://sheets.googleapis.com/v4/spreadsheets/${encodedSpreadsheetId}/values/${range}`;

  const headers: Record<string, string> = {};
  const secrets: string[] = [];

  if (config.google?.apiKey) {
    url += `?key=${encodeURIComponent(config.google.apiKey)}`;
    secrets.push(config.google.apiKey);
  } else if (config.google?.privateKey) {
    // Service account token bearer would go here
    secrets.push(config.google.privateKey);
  }

  // 3. Fetch data via bounded HTTP client
  const response = await pilotFetch<{ values?: unknown[][] }>(
    url,
    { method: 'GET', headers },
    { secrets, retries: 2 },
  );

  const rawValues = response.data?.values ?? [];

  // 4. Parse bounded source row
  const row = parseRequest(rawValues, requestId);

  // 5. Evaluate checklist
  const checklist = evaluateChecklist(row);

  // 6. Generate sourceKey
  const key = sourceKey({
    groupId: config.boardId, // pilot group scope
    spreadsheetId,
    tabId,
    requestId,
  });

  return {
    row,
    checklist,
    sourceKey: key,
    sourceRevision: checklist.sourceRevision,
  };
}
