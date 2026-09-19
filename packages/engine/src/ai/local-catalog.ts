import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ToolSchema, canonicalJson, hash, type EngineTool } from "../snapshot.js";
import {
  CatalogValidationError,
  createReviewedCatalogSnapshot,
  qualifiedToolIdentity,
  type ReviewedCatalogSnapshot,
} from "./catalog.js";

const ManifestToolSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    sideEffect: z.enum(["read", "write"]),
    policyVersion: z.string().min(1),
    evidence: z.literal("IMPLEMENTED_LIVE_DISCOVERY_CHECKED"),
  })
  .passthrough();
const ManifestSchema = z
  .object({
    profile: z.literal("B-local-v1"),
    servers: z.array(
      z
        .object({
          slug: z.enum(["task_hub", "filesystem"]),
          tools: z.array(ManifestToolSchema),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const OfflineManifestEvidenceSchema = z
  .object({
    profile: z.literal("B-local-v1"),
    evidence: z.literal("MIXED_IMPLEMENTED_AND_PLANNED_CONTRACTS"),
  })
  .passthrough();

type LocalManifestTool = z.infer<typeof ManifestToolSchema> & {
  readonly server: EngineTool["server"];
};

function localManifestTools(value: unknown): readonly LocalManifestTool[] {
  const parsed = ManifestSchema.safeParse(value);
  if (!parsed.success)
    throw new CatalogValidationError(
      "local reviewed catalog manifest is malformed",
    );
  if (parsed.data.servers.length !== 2)
    throw new CatalogValidationError(
      "local reviewed catalog must declare exactly two server blocks",
    );
  const slugs = parsed.data.servers.map((server) => server.slug);
  if (new Set(slugs).size !== slugs.length)
    throw new CatalogValidationError(
      "local reviewed catalog contains duplicate server blocks",
    );
  const servers = new Map(
    parsed.data.servers.map((server) => [server.slug, server]),
  );
  const taskHub = servers.get("task_hub")?.tools ?? [];
  const filesystem = servers.get("filesystem")?.tools ?? [];
  if (taskHub.length !== 8 || filesystem.length !== 2)
    throw new CatalogValidationError(
      "local reviewed catalog must contain exactly 8 task_hub and 2 filesystem tools",
    );
  const tools = [
    ...taskHub.map((tool) => ({ ...tool, server: "task_hub" as const })),
    ...filesystem.map((tool) => ({ ...tool, server: "filesystem" as const })),
  ];
  const identities = new Set<string>();
  for (const tool of tools) {
    const identity = qualifiedToolIdentity(tool);
    if (identities.has(identity))
      throw new CatalogValidationError(
        `duplicate local reviewed manifest tool: ${identity}`,
      );
    identities.add(identity);
  }
  return tools;
}

/**
 * Binds descriptions from the checked-in reviewed manifest to tools already
 * reviewed by the live gateway. The manifest alone never creates a capability.
 */
export function createLocalReviewedCatalog(
  manifest: unknown,
  gatewayTools: readonly EngineTool[],
): ReviewedCatalogSnapshot {
  const manifestTools = localManifestTools(manifest);
  if (!Array.isArray(gatewayTools) || gatewayTools.length !== 10)
    throw new CatalogValidationError(
      "current gateway catalog must contain exactly 10 reviewed tools",
    );

  const expected = new Map(
    manifestTools.map((tool) => [qualifiedToolIdentity(tool), tool]),
  );
  const actual = new Map<string, EngineTool>();
  for (const gatewayTool of gatewayTools) {
    const parsedGatewayTool = ToolSchema.safeParse(gatewayTool);
    if (!parsedGatewayTool.success)
      throw new CatalogValidationError(
        "current gateway tool is not a reviewed EngineTool",
      );
    const current = parsedGatewayTool.data;
    const identity = qualifiedToolIdentity(current);
    if (actual.has(identity))
      throw new CatalogValidationError(
        `duplicate current gateway tool: ${identity}`,
      );
    const manifestTool = expected.get(identity);
    if (!manifestTool)
      throw new CatalogValidationError(
        `unreviewed current gateway tool: ${identity}`,
      );
    if (
      current.sideEffect !== manifestTool.sideEffect ||
      current.policyVersion !== manifestTool.policyVersion ||
      canonicalJson(current.inputSchema) !==
        canonicalJson(manifestTool.inputSchema) ||
      canonicalJson(current.outputSchema) !==
        canonicalJson(manifestTool.outputSchema)
    )
      throw new CatalogValidationError(
        `current gateway tool differs from review: ${identity}`,
      );
    actual.set(identity, current);
  }
  if (actual.size !== expected.size)
    throw new CatalogValidationError(
      "current gateway catalog is missing a reviewed tool",
    );

  return createReviewedCatalogSnapshot(
    manifestTools.map((tool) => ({
      ...actual.get(qualifiedToolIdentity(tool))!,
      description: tool.description,
    })),
  );
}

/**
 * Build the checked-in 8+2 reviewed snapshot for an explicitly offline
 * evaluator. Unlike createLocalReviewedCatalog, this has no gateway dependency
 * and its artifact hashes are labelled synthetic manifest fingerprints.
 */
export function createOfflineReviewedCatalog(
  manifest: unknown,
): ReviewedCatalogSnapshot {
  if (!OfflineManifestEvidenceSchema.safeParse(manifest).success)
    throw new CatalogValidationError(
      "offline reviewed catalog manifest evidence is malformed",
    );
  const manifestTools = localManifestTools(manifest);
  return createReviewedCatalogSnapshot(
    manifestTools.map(({ evidence, description, ...tool }) => {
      const candidate = {
        ...tool,
        artifactHash: hash({
          format: "ai-offline-reviewed-manifest-artifact-v1",
          evidence,
          tool: { ...tool, description },
        }),
      };
      const parsed = ToolSchema.safeParse(candidate);
      if (!parsed.success)
        throw new CatalogValidationError(
          "offline reviewed catalog tool is not a reviewed EngineTool",
        );
      return { ...parsed.data, description };
    }),
  );
}

export function loadLocalReviewedCatalog(
  projectRoot: string,
  gatewayTools: readonly EngineTool[],
): ReviewedCatalogSnapshot {
  if (!path.isAbsolute(projectRoot))
    throw new CatalogValidationError("project root must be absolute");
  const source = path.join(projectRoot, "testdata", "tools.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(source, "utf8"));
  } catch {
    throw new CatalogValidationError(
      "local reviewed catalog manifest is unreadable",
    );
  }
  return createLocalReviewedCatalog(manifest, gatewayTools);
}
