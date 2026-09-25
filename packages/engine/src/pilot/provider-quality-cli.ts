import { runPilotMeasuredQualityCase, runPilotProviderQualityCase, type PilotQualityCaseParams, type PilotQualityMode, type PilotQualityRetriever } from './provider-quality-runner.js';
import type { PilotQualityMeasuredGate } from './quality-journal.js';

/** No provider is constructed here; a caller must explicitly inject test ports. */
export async function runPilotProviderQualityCli(
  args: readonly string[],
  deps: Omit<PilotQualityCaseParams, 'mode' | 'retriever'> & { readonly retriever?: PilotQualityRetriever; readonly gate?: PilotQualityMeasuredGate; readonly currentApiKeySha256?: string },
): Promise<{ status: 'NOT_RUN' | 'SIMULATED_ONLY' | 'PROVIDER_OBSERVED'; reason?: string; observation?: unknown }> {
  const phaseIndex = args.indexOf('--phase');
  const modeIndex = args.indexOf('--mode');
  const phase = phaseIndex >= 0 ? args[phaseIndex + 1] : undefined;
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : undefined;
  if (!['probe', 'smoke', 'public', 'holdout'].includes(phase ?? '') ||
      (mode !== 'semantic' && mode !== 'semantic+QE' && mode !== 'fixed-catalog')) {
    throw new Error('QUALITY_CLI_ARGUMENTS: --phase and --mode are required');
  }
  if (!args.includes('--execute')) {
    return { status: 'NOT_RUN', reason: 'Explicit --execute required' };
  }
  const dataset = phase === 'holdout' ? 'holdout' : 'public';
  if (deps.dataset !== dataset) {
    throw new Error('QUALITY_PHASE_DATASET_MISMATCH');
  }
  if (args.includes('--measured')) {
    if (mode !== 'fixed-catalog' || !deps.gate || !deps.currentApiKeySha256) {
      throw new Error('QUALITY_MEASURED_GATE_REQUIRED: fixed-catalog, credential identity and durable campaign gate required');
    }
    const observation = await runPilotMeasuredQualityCase({ ...deps, gate: deps.gate,
      currentApiKeySha256: deps.currentApiKeySha256 });
    return { status: 'PROVIDER_OBSERVED', observation };
  }
  if (mode === 'fixed-catalog' || deps.retriever?.kind !== 'simulated') {
    throw new Error('QUALITY_MEASURED_GATE_REQUIRED: fixed-catalog requires a durable campaign gate');
  }
  const observation = await runPilotProviderQualityCase({
    ...deps, retriever: deps.retriever, mode: mode as PilotQualityMode,
  });
  return { status: 'SIMULATED_ONLY', observation };
}
