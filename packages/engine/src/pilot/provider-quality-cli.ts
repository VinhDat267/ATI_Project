import { runPilotProviderQualityCase, type PilotQualityCaseParams, type PilotQualityMode } from './provider-quality-runner.js';

/** No provider is constructed here; a caller must explicitly inject test ports. */
export async function runPilotProviderQualityCli(
  args: readonly string[],
  deps: Omit<PilotQualityCaseParams, 'mode'>,
): Promise<{ status: 'NOT_RUN' | 'SIMULATED_ONLY'; reason?: string; observation?: unknown }> {
  const phaseIndex = args.indexOf('--phase');
  const modeIndex = args.indexOf('--mode');
  const phase = phaseIndex >= 0 ? args[phaseIndex + 1] : undefined;
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : undefined;
  if (!['probe', 'smoke', 'public', 'holdout'].includes(phase ?? '') ||
      (mode !== 'semantic' && mode !== 'semantic+QE')) {
    throw new Error('QUALITY_CLI_ARGUMENTS: --phase and --mode are required');
  }
  if (!args.includes('--execute')) {
    return { status: 'NOT_RUN', reason: 'Explicit --execute required' };
  }
  if (args.includes('--measured') || deps.retriever.kind !== 'simulated') {
    throw new Error('QUALITY_MEASURED_NOT_READY: approved pilot retriever, ledger and campaign approval required');
  }
  const dataset = phase === 'holdout' ? 'holdout' : 'public';
  if (deps.dataset !== dataset) {
    throw new Error('QUALITY_PHASE_DATASET_MISMATCH');
  }
  const observation = await runPilotProviderQualityCase({
    ...deps, mode: mode as PilotQualityMode,
  });
  return { status: 'SIMULATED_ONLY', observation };
}
