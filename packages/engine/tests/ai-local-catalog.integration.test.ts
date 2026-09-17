import { afterAll, describe, expect, it } from "vitest";
import { openLocalGateway } from "../src/gateway.js";
import { loadLocalReviewedCatalog } from "../src/ai/local-catalog.js";
import { toolContentHash } from "../src/ai/catalog.js";
import {
  PGVECTOR_DIMENSIONS,
  PgvectorCatalogIndex,
  PgvectorToolRetriever,
} from "../src/ai/pgvector-index.js";
import { makeFilesystemFixture } from "./filesystem-fixture.js";

describe("AI-01 local catalog to reviewed two-server gateway", () => {
  let fixture: Awaited<ReturnType<typeof makeFilesystemFixture>> | undefined;

  afterAll(async () => {
    await fixture?.close();
  });

  it("captures the reviewed 8+2 snapshot only after both live local gateways validate", async () => {
    fixture = await makeFilesystemFixture();
    const gateway = await openLocalGateway(fixture.gatewayConfig);
    try {
      await gateway.assertCurrent();
      const snapshot = loadLocalReviewedCatalog(
        fixture.projectRoot,
        gateway.tools,
      );
      expect(snapshot.tools).toHaveLength(10);
      expect(
        snapshot.tools.map((tool) => `${tool.server}.${tool.name}`),
      ).toEqual([
        "filesystem.read_file",
        "filesystem.write_file",
        "task_hub.append_sheet_rows",
        "task_hub.create_card",
        "task_hub.get_card",
        "task_hub.list_cards",
        "task_hub.list_members",
        "task_hub.move_card",
        "task_hub.read_sheet_range",
        "task_hub.send_slack_message",
      ]);
      const vector = (position: number) =>
        Array.from({ length: PGVECTOR_DIMENSIONS }, (_, index) =>
          index === position ? 1 : 0,
        );
      const index = new PgvectorCatalogIndex(fixture.db, fixture.userId);
      const active = await index.activate({
        catalog: snapshot,
        rows: snapshot.tools.map((tool, position) => ({
          server: tool.server,
          name: tool.name,
          vector: vector(position),
          contentHash: toolContentHash(tool),
          provenance: {
            provider: "test-provider",
            model: "test-embedding",
            dimensions: PGVECTOR_DIMENSIONS,
            preprocessingVersion: "normalized-v1",
            catalogHash: snapshot.catalogHash,
          },
        })),
      });
      const retriever = new PgvectorToolRetriever({
        catalog: snapshot,
        index,
        embeddingPort: {
          async embed() {
            return { embedding: vector(0), ...active.provenance, usage: null };
          },
        },
      });
      const result = await retriever.retrieve({
        query: "read local file",
        variant: "semantic",
        topK: 3,
      });
      expect(result.tools[0]).toMatchObject({
        name: "read_file",
        server: "filesystem",
      });
    } finally {
      await gateway.close();
    }
  });
});
