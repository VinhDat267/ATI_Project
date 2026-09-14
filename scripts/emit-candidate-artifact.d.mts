export type ArtifactFileComparison = {
  file: string;
  sha256: string;
  expected_baseline_sha256: string;
  matches: true;
};
export function validateArtifactFiles(files: unknown, expectedHashes: unknown): ArtifactFileComparison[];
export function extractRawSchemaHashes(probeFilePath: string, probeDataOverride?: unknown): Record<string, string>;
