import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AiPlannerAdapter,
  AiPlannerError,
  InMemoryToolRetriever,
  loadLocalReviewedCatalog,
  toolContentHash,
  type EngineTool,
  type PlannerPort,
  type StructuredModelClient,
  type EmbeddingPort,
  type QueryExpansionPort,
  type ToolEmbeddingRow,
  type RetrievalVariant,
} from "@wap/engine";

export interface LoadAiPlannerOptions {
  readonly root: string;
  readonly modelClient?: StructuredModelClient;
  readonly embeddingPort?: EmbeddingPort;
  readonly queryExpansionPort?: QueryExpansionPort;
  readonly variant?: RetrievalVariant;
  readonly topK?: number;
  readonly maxPlanningCalls?: number;
  readonly deadlineMs?: number;
}

const DEFAULT_PROVENANCE = {
  provider: "openai-compatible",
  model: "text-embedding-3-small",
  dimensions: 1536,
  preprocessingVersion: "v1",
};

function deterministicEmbedding(text: string, dimensions = 1536): readonly number[] {
  const vec = new Float64Array(dimensions);
  const normalized = text.toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    const idx = (code * 37 + i * 17) % dimensions;
    vec[idx] = (vec[idx] ?? 0) + 1.0;
  }
  vec[0] = (vec[0] ?? 0) + 0.01;
  let normSq = 0;
  for (let i = 0; i < dimensions; i++) {
    normSq += vec[i]! * vec[i]!;
  }
  const norm = Math.sqrt(normSq);
  return Array.from(vec, (v) => v / norm);
}

function currentReviewedGatewayTools(root: string): EngineTool[] {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "testdata", "tools.json"), "utf8"),
  ) as {
    servers: {
      slug: EngineTool["server"];
      tools: (Omit<EngineTool, "server" | "artifactHash"> & {
        description: string;
        evidence: string;
      })[];
    }[];
  };
  return manifest.servers.flatMap((server) =>
    server.tools.map(
      ({ description: _description, evidence: _evidence, ...tool }) => ({
        ...tool,
        server: server.slug,
        artifactHash: "a".repeat(64),
      }),
    ),
  );
}

export function loadAiPlanner(options: LoadAiPlannerOptions): PlannerPort {
  const catalog = loadLocalReviewedCatalog(
    options.root,
    currentReviewedGatewayTools(options.root),
  );
  const catalogHash = catalog.catalogHash;

  const rows: ToolEmbeddingRow[] = catalog.tools.map((tool) => {
    const toolText = `${tool.server}.${tool.name}: ${tool.description}`;
    return {
      server: tool.server,
      name: tool.name,
      vector: deterministicEmbedding(toolText, DEFAULT_PROVENANCE.dimensions),
      contentHash: toolContentHash(tool),
      provenance: {
        ...DEFAULT_PROVENANCE,
        catalogHash,
      },
    };
  });

  const embeddingPort: EmbeddingPort = options.embeddingPort ?? {
    async embed(req) {
      return {
        embedding: deterministicEmbedding(req.text, DEFAULT_PROVENANCE.dimensions),
        ...DEFAULT_PROVENANCE,
        catalogHash,
        usage: null,
      };
    },
  };

  const retriever = new InMemoryToolRetriever({
    catalog,
    rows,
    embeddingPort,
    queryExpansionPort: options.queryExpansionPort,
  });

  const defaultUnconfiguredClient: StructuredModelClient = {
    async complete() {
      throw new AiPlannerError(
        "INVALID_CONFIGURATION",
        "AI model provider unconfigured: missing provider credentials. Silent fallback to dev_fixture is forbidden.",
        0,
      );
    },
  };

  const model = options.modelClient ?? defaultUnconfiguredClient;

  return new AiPlannerAdapter({
    retriever,
    model,
    variant: options.variant ?? "all_tools",
    topK: options.topK ?? 10,
    maxPlanningCalls: options.maxPlanningCalls ?? 3,
    deadlineMs: options.deadlineMs ?? 60_000,
    validatePlan: () => [],
  });
}
