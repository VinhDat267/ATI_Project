import { canonicalJson } from "../../snapshot.js";
import {
  EvalDatasetSchema,
  ExperimentManifestSchema,
  FrozenEvaluationSchema,
  type EvalDataset,
  type FrozenEvaluation,
  type Split,
} from "./contracts.js";

export class EvaluationDatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationDatasetError";
  }
}

function parseTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new EvaluationDatasetError("evaluation runtime time zone is invalid");
  }
}

function assertExactSplit(
  actual: readonly string[],
  expected: readonly string[],
  split: Split,
): void {
  if (
    actual.length !== expected.length ||
    actual.some((id, index) => id !== expected[index])
  )
    throw new EvaluationDatasetError(
      `evaluation manifest ${split} split does not match dataset`,
    );
}

export function parseDataset(raw: unknown, manifestRaw: unknown): EvalDataset {
  const dataset = EvalDatasetSchema.safeParse(raw);
  if (!dataset.success)
    throw new EvaluationDatasetError("evaluation dataset is malformed");
  const manifest = ExperimentManifestSchema.safeParse(manifestRaw);
  if (!manifest.success)
    throw new EvaluationDatasetError("evaluation manifest is malformed");
  if (dataset.data.profile !== manifest.data.profile)
    throw new EvaluationDatasetError("evaluation dataset profile does not match manifest");
  parseTimeZone(dataset.data.runtime.time_zone);

  const ids = dataset.data.cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length)
    throw new EvaluationDatasetError("evaluation dataset contains duplicate case IDs");
  const dev = dataset.data.cases
    .filter((item) => item.split === "dev")
    .map((item) => item.id);
  const holdout = dataset.data.cases
    .filter((item) => item.split === "holdout")
    .map((item) => item.id);
  assertExactSplit(manifest.data.split.dev, dev, "dev");
  assertExactSplit(manifest.data.split.holdout, holdout, "holdout");
  if (dev.length !== 6 || holdout.length !== 4)
    throw new EvaluationDatasetError("evaluation dataset must contain six dev and four holdout cases");
  if (new Set([...dev, ...holdout]).size !== 10)
    throw new EvaluationDatasetError("evaluation split IDs must be unique");
  return dataset.data;
}

export function selectCases(
  dataset: EvalDataset,
  split: Split,
): readonly EvalDataset["cases"][number][] {
  return dataset.cases.filter((item) => item.split === split);
}

/**
 * Ensure every hand-authored expected plan only refers to a capability present
 * in the frozen reviewed catalog. This is checked before any model call.
 */
export function assertCatalogSupportsDataset(
  dataset: EvalDataset,
  catalog: readonly { readonly server: string; readonly name: string }[],
): void {
  const identities = catalog.map((tool) => `${tool.server}.${tool.name}`);
  if (new Set(identities).size !== identities.length)
    throw new EvaluationDatasetError("evaluation catalog contains duplicate tool identities");
  const available = new Set(identities);
  for (const fixture of dataset.cases) {
    if (fixture.expected_result.kind !== "plan") continue;
    for (const step of fixture.expected_result.plan.steps) {
      const identity = `${step.tool.server}.${step.tool.name}`;
      if (!available.has(identity))
        throw new EvaluationDatasetError(
          `evaluation catalog missing expected fixture tool: ${identity}`,
        );
    }
  }
}

export function assertFrozen(
  actualRaw: unknown,
  savedRaw: unknown,
): asserts actualRaw is FrozenEvaluation {
  const actual = FrozenEvaluationSchema.safeParse(actualRaw);
  const saved = FrozenEvaluationSchema.safeParse(savedRaw);
  if (!actual.success || !saved.success)
    throw new EvaluationDatasetError("evaluation freeze is malformed");
  if (canonicalJson(actual.data) !== canonicalJson(saved.data))
    throw new EvaluationDatasetError("evaluation freeze does not match current inputs");
}

export type { FrozenEvaluation } from "./contracts.js";
