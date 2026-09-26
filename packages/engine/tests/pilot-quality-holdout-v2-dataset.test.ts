import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { V2DatasetSchema } from "../src/pilot/dataset-schema.js";
import {
  assertPilotModelFixtureCompatible,
  classifyPilotModelQualityCase,
} from "../src/pilot/quality-scope.js";

const root = resolve(import.meta.dirname, "../../..");
const datasetPath = resolve(root, "testdata/v2-dataset/ai-holdout-v2.json");
const metadataPath = resolve(
  root,
  "testdata/v2-dataset/ai-holdout-v2.meta.json",
);
const publicPath = resolve(root, "testdata/v2-dataset/cases.json");

describe("fresh independent model-only-v2 holdout", () => {
  const bytes = readFileSync(datasetPath);
  const parsed = V2DatasetSchema.parse(JSON.parse(bytes.toString("utf8")));
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));

  it("has 10 disjoint bilingual cases with unique variant IDs and bound provenance", () => {
    expect(parsed.version).toBe("ai-holdout-v2");
    expect(parsed.cases).toHaveLength(20);
    expect(new Set(parsed.cases.map((entry) => entry.variantId)).size).toBe(20);
    expect(new Set(parsed.cases.map((entry) => entry.caseId))).toEqual(
      new Set(
        Array.from(
          { length: 10 },
          (_, index) => `H2-${String(index + 1).padStart(2, "0")}`,
        ),
      ),
    );
    const publicIds = new Set(
      JSON.parse(readFileSync(publicPath, "utf8")).cases.map(
        (entry: { caseId: string }) => entry.caseId,
      ),
    );
    expect(parsed.cases.some((entry) => publicIds.has(entry.caseId))).toBe(false);
    for (const caseId of new Set(parsed.cases.map((entry) => entry.caseId))) {
      expect(
        parsed.cases
          .filter((entry) => entry.caseId === caseId)
          .map((entry) => entry.language)
          .sort(),
      ).toEqual(["en", "vi"]);
    }
    expect(metadata.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(metadata.independence).toMatch(
      /no prompts, expected answers, or observations copied/i,
    );
    expect(metadata.source.realSaaSAccessed).toBe(false);
  });

  it("validates trusted spreadsheet and tab metadata and the source contract for every case", () => {
    for (const entry of parsed.cases) {
      expect(entry.sourceFixture.spreadsheetId?.trim()).toBeTruthy();
      expect(entry.sourceFixture.tabId?.trim()).toBeTruthy();
      expect(entry.resourcePolicy.allowedSources).toContain(
        entry.sourceFixture.spreadsheetId,
      );
      expect(
        () =>
          assertPilotModelFixtureCompatible(entry, "holdout", "model-only-v2"),
        entry.variantId,
      ).not.toThrow();
      expect(classifyPilotModelQualityCase(entry, "holdout").eligible).toBe(
        true,
      );
    }
  });
});
