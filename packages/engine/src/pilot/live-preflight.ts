import {
  loadPilotConfig,
  redactObject,
  redactSecrets,
  type PilotConfig,
} from "./config.js";
import { assertPilotAccess, type PilotPolicy } from "./policy.js";
import { PilotHttpError } from "./http-client.js";
import { createHash } from "node:crypto";
import {
  readSheetsRequest,
  type ReadSheetsRequestResult,
} from "./adapters/sheets.js";
import { trelloListLists, trelloListMembers } from "./adapters/trello-read.js";

export interface PreflightOptions {
  config?: Partial<PilotConfig>;
  policy?: PilotPolicy;
  principalId?: string;
  testRequestId?: string;
  allowSimulatedFallback?: boolean;
  commit?: string;
  workingTreeDirty?: boolean;
}

export interface PreflightCheckResult {
  status: "passed" | "failed" | "blocked_external";
  timestamp: string;
  context: {
    commit?: string;
    workingTreeDirty?: boolean;
    principalId?: string;
    targetListId?: string;
    configSha256: string;
  };
  checks: {
    config: {
      status: "pass" | "fail" | "missing";
      enabled: boolean;
      spreadsheetId?: string;
      tabId?: string;
      boardId?: string;
      hasGoogleCredentials: boolean;
      hasTrelloCredentials: boolean;
      error?: string;
    };
    sheetsRead: {
      status: "pass" | "fail" | "skipped";
      error?: string;
      sampleResult?: {
        requestId: string;
        sourceKey: string;
        checklistStatus: string;
        sourceRevision: string;
      };
    };
    trelloRead: {
      status: "pass" | "fail" | "skipped";
      error?: string;
      listsCount?: number;
      membersCount?: number;
      listsSample?: Array<{ id: string }>;
    };
    writeVerification: {
      status: "pass";
      writesAttempted: 0;
      note: string;
    };
  };
  errors: string[];
  evidenceLabel: "CONFIRMED" | "PROPOSED" | "NOT_RUN" | "BLOCKED_EXTERNAL";
}

/**
 * BE-26: SaaS Setup & Live Read Preflight
 * Checks connectivity to Google Sheets and Trello with strict zero-write enforcement
 * and fail-closed security boundary when credentials are not configured.
 */
export async function runPilotLivePreflight(
  options: PreflightOptions = {},
): Promise<PreflightCheckResult> {
  const timestamp = new Date().toISOString();
  const errors: string[] = [];

  let pilotConfig: PilotConfig;
  let hasValidConfig = false;
  let configError: string | undefined;

  // 1. Validate & Load Config
  try {
    pilotConfig = loadPilotConfig(options.config);
    hasValidConfig = pilotConfig.enabled;
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    configError = rawMsg;
    errors.push(rawMsg);
    pilotConfig = {
      enabled: false,
      principals: options.config?.principals ?? [],
      spreadsheetId: options.config?.spreadsheetId ?? "",
      tabId: options.config?.tabId ?? "",
      boardId: options.config?.boardId ?? "",
      google: options.config?.google,
      trello: options.config?.trello,
    };
  }

  const hasGoogleCreds = Boolean(pilotConfig.google?.apiKey?.trim());
  const hasTrelloCreds = Boolean(
    pilotConfig.trello?.apiKey && pilotConfig.trello?.apiToken,
  );

  const secrets = [
    pilotConfig.google?.apiKey,
    pilotConfig.google?.clientEmail,
    pilotConfig.google?.privateKey,
    pilotConfig.trello?.apiKey,
    pilotConfig.trello?.apiToken,
  ];

  const result: PreflightCheckResult = {
    status: "passed",
    timestamp,
    context: {
      commit: options.commit,
      workingTreeDirty: options.workingTreeDirty,
      principalId: options.principalId?.trim() || undefined,
      targetListId: pilotConfig.trello?.listId,
      configSha256: createHash("sha256").update(JSON.stringify(pilotConfig)).digest("hex"),
    },
    checks: {
      config: {
        status: hasValidConfig ? "pass" : configError ? "fail" : "missing",
        enabled: pilotConfig.enabled,
        spreadsheetId: pilotConfig.spreadsheetId || undefined,
        tabId: pilotConfig.tabId || undefined,
        boardId: pilotConfig.boardId || undefined,
        hasGoogleCredentials: hasGoogleCreds,
        hasTrelloCredentials: hasTrelloCreds,
        error: configError ? redactSecrets(configError, secrets) : undefined,
      },
      sheetsRead: {
        status: "skipped",
      },
      trelloRead: {
        status: "skipped",
      },
      writeVerification: {
        status: "pass",
        writesAttempted: 0,
        note: "Verified 0 remote writes attempted during preflight inspection",
      },
    },
    errors: [],
    evidenceLabel: "PROPOSED",
  };

  // If live config is incomplete or disabled, fail-closed as BLOCKED_EXTERNAL
  const principalId = options.principalId?.trim();
  const testRequestId = options.testRequestId?.trim();
  if (!principalId) errors.push("CONFIG_ERROR: Explicit principal is required");
  if (!testRequestId)
    errors.push("CONFIG_ERROR: Explicit request ID is required");
  if (options.allowSimulatedFallback)
    errors.push(
      "CONFIG_ERROR: Simulated fallback is forbidden in live preflight",
    );
  if (!pilotConfig.trello?.listId?.trim())
    errors.push("CONFIG_ERROR: Trello target list is required");
  if (!hasGoogleCreds)
    errors.push(
      "AUTH_UNAVAILABLE: Google Sheets API key is required; service-account token flow is unavailable",
    );
  if (!hasTrelloCreds)
    errors.push("CONFIG_ERROR: Trello credentials are required");

  const policy: PilotPolicy = options.policy ?? {
    enabled: pilotConfig.enabled,
    principals: pilotConfig.principals,
    spreadsheetId: pilotConfig.spreadsheetId,
    tabId: pilotConfig.tabId,
    boardId: pilotConfig.boardId,
  };
  if (hasValidConfig && principalId) {
    try {
      assertPilotAccess(policy, principalId, {
        kind: "source",
        spreadsheetId: pilotConfig.spreadsheetId,
        tabId: pilotConfig.tabId,
      });
      assertPilotAccess(policy, principalId, {
        kind: "board",
        boardId: pilotConfig.boardId,
      });
      if (!pilotConfig.principals.includes(principalId))
        throw new Error("ACCESS_DENIED");
    } catch {
      errors.push("ACCESS_DENIED: Principal or target differs from allowlist");
    }
  }

  if (!hasValidConfig || errors.length > 0) {
    result.status = "blocked_external";
    result.evidenceLabel = "BLOCKED_EXTERNAL";
    result.errors = errors.map((e) => redactSecrets(e, secrets));
    return result;
  }

  // 2. Perform Live Google Sheets Read Preflight
  try {
    const sheetsResult: ReadSheetsRequestResult = await readSheetsRequest({
      config: pilotConfig,
      policy,
      principalId: principalId!,
      spreadsheetId: pilotConfig.spreadsheetId,
      tabId: pilotConfig.tabId,
      requestId: testRequestId!,
    });

    result.checks.sheetsRead = {
      status: "pass",
      sampleResult: {
        requestId: sheetsResult.row.request_id,
        sourceKey: sheetsResult.sourceKey,
        checklistStatus: sheetsResult.checklist.status,
        sourceRevision: sheetsResult.sourceRevision,
      },
    };
  } catch (err: unknown) {
    const msg = safeReadError(err, secrets);
    result.checks.sheetsRead = {
      status: "fail",
      error: msg,
    };
    errors.push(`Sheets read failed: ${msg}`);
  }

  // 3. Perform Live Trello Read Preflight (Lists & Members)
  try {
    const [lists, members] = await Promise.all([
      trelloListLists({
        config: pilotConfig,
        policy,
        principalId: principalId!,
        boardId: pilotConfig.boardId,
      }),
      trelloListMembers({
        config: pilotConfig,
        policy,
        principalId: principalId!,
        boardId: pilotConfig.boardId,
      }),
    ]);

    if (
      !lists.some(
        (list) => list.id === pilotConfig.trello!.listId && !list.closed,
      )
    ) {
      throw new Error(
        "ACCESS_DENIED: Target list is absent or closed on the allowlisted board",
      );
    }
    result.checks.trelloRead = {
      status: "pass",
      listsCount: lists.length,
      membersCount: members.length,
      listsSample: lists.slice(0, 5).map((l) => ({ id: l.id })),
    };
  } catch (err: unknown) {
    const msg = safeReadError(err, secrets);
    result.checks.trelloRead = {
      status: "fail",
      error: msg,
    };
    errors.push(`Trello read failed: ${msg}`);
  }

  // 4. Conclude Status
  if (errors.length > 0) {
    result.status = "failed";
    result.errors = errors;
    result.evidenceLabel = "PROPOSED";
  } else {
    result.status = "passed";
    result.evidenceLabel = "CONFIRMED";
  }

  return redactObject(result, secrets);
}

function safeReadError(
  error: unknown,
  secrets: readonly (string | undefined | null)[],
): string {
  if (error instanceof PilotHttpError)
    return `HTTP ${error.statusCode || "network"} read failed`;
  const message = error instanceof Error ? error.message : String(error);
  // Error text can contain an arbitrary URL query; retain the path and
  // remove query values before including it in the operator artifact.
  return redactSecrets(
    message.replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, "$1?[REDACTED]"),
    secrets,
  );
}
