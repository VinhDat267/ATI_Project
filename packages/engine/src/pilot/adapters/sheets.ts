import { assertPilotAccess, type PilotPolicy } from "../policy.js";
import { parseRequest, type SourceRow } from "../source.js";
import { evaluateChecklist, type ChecklistResult } from "../checklist.js";
import { sourceKey } from "../identity.js";
import { pilotFetch } from "../http-client.js";
import type { PilotConfig } from "../config.js";

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
  const { config, policy, principalId, spreadsheetId, tabId, requestId } =
    params;

  // 1. Policy check (enforce allowlist)
  assertPilotAccess(policy, principalId, {
    kind: "source",
    spreadsheetId,
    tabId,
  });
  if (
    !config.enabled ||
    config.spreadsheetId !== spreadsheetId ||
    config.tabId !== tabId ||
    config.boardId !== policy.boardId
  ) {
    throw new Error("ACCESS_DENIED");
  }

  // An API key can read an appropriately shared source. Service-account keys
  // cannot authenticate a Sheets GET without a signed OAuth bearer token.
  // Until that token flow exists, never send an anonymous request for them.
  const apiKey = config.google?.apiKey?.trim();
  if (!apiKey) {
    if (config.google?.clientEmail && config.google.privateKey) {
      throw new Error(
        "AUTH_UNAVAILABLE: Service-account Sheets reads require a bearer-token path",
      );
    }
    throw new Error("CONFIG_ERROR: Missing Google credentials");
  }

  // 2. Build URL and authorization
  const range = `${encodeURIComponent(tabId)}!A1:H101`;
  const encodedSpreadsheetId = encodeURIComponent(spreadsheetId);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodedSpreadsheetId}/values/${range}?key=${encodeURIComponent(apiKey)}`;

  // 3. Fetch data via bounded HTTP client
  const response = await pilotFetch<{ values?: unknown[][] }>(
    url,
    { method: "GET" },
    { secrets: [apiKey], retries: 2 },
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
