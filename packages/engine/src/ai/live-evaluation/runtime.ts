import type {
  LiveEvaluationSession,
  LiveEvaluationSessionContext,
} from "./runner.js";
import type { ProviderCallLedger } from "../providers/registry.js";
import type { RetrievalVariant } from "../retrieval.js";

export interface LiveProbeRequest {
  readonly campaignId: string;
  readonly profileId: string;
  readonly phase: "probe";
  readonly signal?: AbortSignal;
}

export interface LiveProbeCallEvidence {
  readonly role: string;
  readonly provider: string;
  readonly model: string;
  readonly requestId?: string | null;
  readonly usage?: Readonly<Record<string, number>> | null;
}

export interface LiveProbeResult {
  readonly calls: readonly LiveProbeCallEvidence[];
}

export interface LiveIndexRequest {
  readonly campaignId: string;
  readonly profileId: string;
  readonly phase: "index";
  readonly signal?: AbortSignal;
}

export interface LiveIndexResult {
  readonly index: {
    readonly id: string;
    readonly provenanceHash: string;
    readonly vectorHash: string;
    readonly policyHash: string;
  };
  readonly rowCount: number;
}

export interface LiveEvaluationRuntime {
  readonly evidenceKind?: "LIVE_PROVIDER" | "FAKE_TRANSPORT_TEST";
  readonly probe: (request: LiveProbeRequest) => Promise<LiveProbeResult>;
  readonly index: (request: LiveIndexRequest) => Promise<LiveIndexResult>;
  readonly createSession: (
    context: LiveEvaluationSessionContext,
    ledger?: ProviderCallLedger,
    variant?: RetrievalVariant,
  ) => Promise<LiveEvaluationSession>;
  readonly close: () => Promise<void>;
}

export interface LiveEvaluationRuntimeImplementation {
  readonly evidenceKind?: "LIVE_PROVIDER" | "FAKE_TRANSPORT_TEST";
  readonly probe: (request: LiveProbeRequest) => Promise<LiveProbeResult>;
  readonly index: (request: LiveIndexRequest) => Promise<LiveIndexResult>;
  readonly createSession?: (
    context: LiveEvaluationSessionContext,
    ledger?: ProviderCallLedger,
    variant?: RetrievalVariant,
  ) => Promise<LiveEvaluationSession>;
  readonly close?: () => Promise<void>;
}

function assertProbeResult(result: LiveProbeResult): LiveProbeResult {
  if (!result || result.calls.length === 0) {
    throw new Error("live probe must record at least one provider call");
  }
  for (const call of result.calls) {
    if (!call.role || !call.provider || !call.model) {
      throw new Error("live probe returned incomplete provider evidence");
    }
  }
  return result;
}

function assertIndexResult(result: LiveIndexResult): LiveIndexResult {
  if (
    !result?.index?.id ||
    !result.index.provenanceHash ||
    !result.index.vectorHash ||
    !result.index.policyHash ||
    !Number.isInteger(result.rowCount) ||
    result.rowCount < 0
  ) {
    throw new Error(
      "live index runtime returned incomplete activation evidence",
    );
  }
  return result;
}

/**
 * Owns evaluator transport/database lifecycle while keeping provider and DB
 * composition injectable for tests and the CLI composition root.
 */
export function createLiveEvaluationRuntime(
  implementation: LiveEvaluationRuntimeImplementation,
): LiveEvaluationRuntime {
  let closed = false;
  const assertOpen = () => {
    if (closed) throw new Error("live evaluation runtime is closed");
  };
  return {
    ...(implementation.evidenceKind
      ? { evidenceKind: implementation.evidenceKind }
      : {}),
    probe: async (request) => {
      assertOpen();
      return assertProbeResult(await implementation.probe(request));
    },
    index: async (request) => {
      assertOpen();
      return assertIndexResult(await implementation.index(request));
    },
    createSession: async (context, ledger, variant) => {
      assertOpen();
      if (!implementation.createSession) {
        throw new Error("live evaluation session factory is not configured");
      }
      return variant === undefined
        ? implementation.createSession(context, ledger)
        : implementation.createSession(context, ledger, variant);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await implementation.close?.();
    },
  };
}
