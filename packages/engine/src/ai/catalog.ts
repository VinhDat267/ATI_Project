import { z } from "zod";
import {
  ToolSchema,
  canonicalJson,
  hash,
  type EngineTool,
} from "../snapshot.js";

export type ReviewedToolInput = EngineTool & { description: string };
export interface ReviewedCatalogTool extends ReviewedToolInput {}
export interface ReviewedCatalogSnapshot {
  readonly tools: readonly ReviewedCatalogTool[];
  readonly catalogHash: string;
}
export class CatalogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogValidationError";
  }
}

const ReviewedDescriptionSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "description must be non-empty");

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>))
      freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function parseReviewedTool(value: unknown, index: number): ReviewedCatalogTool {
  if (!isRecord(value))
    throw new CatalogValidationError(`tool ${index} must be an object`);
  const { description, ...engineTool } = value;
  const parsedDescription = ReviewedDescriptionSchema.safeParse(description);
  if (!parsedDescription.success)
    throw new CatalogValidationError(
      `tool ${index} description must be non-empty`,
    );
  const parsedTool = ToolSchema.safeParse(engineTool);
  if (!parsedTool.success)
    throw new CatalogValidationError(
      `tool ${index} is not a reviewed EngineTool: ${parsedTool.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  if (parsedTool.data.name.trim().length === 0)
    throw new CatalogValidationError(`tool ${index} name must be non-empty`);
  if (parsedTool.data.policyVersion.trim().length === 0)
    throw new CatalogValidationError(
      `tool ${index} policyVersion must be non-empty`,
    );
  return {
    ...parsedTool.data,
    description: parsedDescription.data,
  };
}

export function qualifiedToolIdentity(tool: {
  server: string;
  name: string;
}): string {
  return `${tool.server}.${tool.name}`;
}

function compareIdentity(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * Hashes the complete reviewed capability description. The caller is responsible
 * for supplying data that was reviewed by the application; this constructor
 * validates shape and immutability, but it is not a trust authenticator.
 */
export function toolContentHash(tool: ReviewedToolInput): string {
  return hash({
    server: tool.server,
    name: tool.name,
    description: tool.description,
    sideEffect: tool.sideEffect,
    policyVersion: tool.policyVersion,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    artifactHash: tool.artifactHash,
  });
}

/** Create a bounded, immutable snapshot from already-reviewed internal tools. */
export function createReviewedCatalogSnapshot(
  tools: readonly ReviewedToolInput[],
): ReviewedCatalogSnapshot {
  if (!Array.isArray(tools))
    throw new CatalogValidationError("catalog tools must be an array");
  if (tools.length > 10)
    throw new CatalogValidationError(
      "reviewed catalog cannot contain more than 10 tools",
    );

  const parsed = tools.map((tool, index) => parseReviewedTool(tool, index));
  const identities = new Set<string>();
  for (const tool of parsed) {
    const identity = qualifiedToolIdentity(tool);
    if (identities.has(identity))
      throw new CatalogValidationError(
        `duplicate reviewed tool identity: ${identity}`,
      );
    identities.add(identity);
  }

  const ordered = [...parsed].sort((a, b) =>
    compareIdentity(qualifiedToolIdentity(a), qualifiedToolIdentity(b)),
  );
  const immutableTools = freezeDeep(
    JSON.parse(canonicalJson(ordered)) as ReviewedCatalogTool[],
  );
  const catalogHash = hash({
    format: "ai-reviewed-catalog-1",
    tools: immutableTools,
  });
  return freezeDeep({ tools: immutableTools, catalogHash });
}
