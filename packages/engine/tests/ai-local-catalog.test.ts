import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EngineTool } from "../src/snapshot.js";
import {
  createLocalReviewedCatalog,
  loadLocalReviewedCatalog,
} from "../src/ai/local-catalog.js";
import { CatalogValidationError } from "../src/ai/catalog.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function currentReviewedGatewayTools(): EngineTool[] {
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

describe("local reviewed 8+2 catalog", () => {
  it("binds the exact reviewed 8+2 manifest to current gateway tools", () => {
    const snapshot = loadLocalReviewedCatalog(
      root,
      currentReviewedGatewayTools().reverse(),
    );

    expect(snapshot.tools).toHaveLength(10);
    expect(
      snapshot.tools.filter((tool) => tool.server === "task_hub"),
    ).toHaveLength(8);
    expect(
      snapshot.tools.filter((tool) => tool.server === "filesystem"),
    ).toHaveLength(2);
    expect(snapshot.tools.map((tool) => tool.description)).not.toContain("");
  });

  it("refuses missing, extra, or manifest-drifted tools before creating a snapshot", () => {
    const tools = currentReviewedGatewayTools();
    expect(() => loadLocalReviewedCatalog(root, tools.slice(1))).toThrow(
      CatalogValidationError,
    );
    expect(() =>
      loadLocalReviewedCatalog(root, [
        ...tools,
        { ...tools[0]!, name: "unreviewed_extra" },
      ]),
    ).toThrow(CatalogValidationError);
    expect(() =>
      loadLocalReviewedCatalog(
        root,
        tools.map((tool) =>
          tool.name === "list_cards"
            ? { ...tool, inputSchema: { type: "object", properties: {} } }
            : tool,
        ),
      ),
    ).toThrow(/schema|reviewed|differs/i);
  });

  it("refuses duplicate server blocks instead of silently dropping reviewed content", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(root, "testdata", "tools.json"), "utf8"),
    ) as { servers: unknown[] };
    manifest.servers.push(structuredClone(manifest.servers[0]!));
    expect(() =>
      createLocalReviewedCatalog(manifest, currentReviewedGatewayTools()),
    ).toThrow(/duplicate|exactly/i);
  });
});
