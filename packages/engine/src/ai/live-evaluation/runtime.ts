import type {
  LiveEvaluationSession,
  LiveEvaluationSessionContext,
} from "./runner.js";

export interface LiveProbeRequest {
  readonly campaignId: string;
  readonly profileId: string;
  readonly phase: "probe";
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
  readonly probe: (request: LiveProbeRequest) => Promise<LiveProbeResult>;
  readonly index: (request: LiveIndexRequest) => Promise<LiveIndexResult>;
  readonly createSession: (
    context: LiveEvaluationSessionContext,
  ) => Promise<LiveEvaluationSession>;
  readonly close: () => Promise<void>;
}

export interface LiveEvaluationRuntimeImplementation {
  readonly probe: (request: LiveProbeRequest) => Promise<LiveProbeResult>;
  readonly index: (request: LiveIndexRequest) => Promise<LiveIndexResult>;
  readonly createSession?: (
    context: LiveEvaluationSessionContext,
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
    probe: async (request) => {
      assertOpen();
      return assertProbeResult(await implementation.probe(request));
    },
    index: async (request) => {
      assertOpen();
      return assertIndexResult(await implementation.index(request));
    },
    createSession: async (context) => {
      assertOpen();
      if (!implementation.createSession) {
        throw new Error("live evaluation session factory is not configured");
      }
      return implementation.createSession(context);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await implementation.close?.();
    },
  };
}
