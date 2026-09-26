/** Select from the caller's eligible PUBLIC cases only; never load holdout here. */
export function selectDiagnosticCase(publicCases, variantId) {
  const selected = publicCases.filter((entry) => entry.variantId === variantId);
  if (typeof variantId !== 'string' || !variantId || selected.length !== 1) {
    throw new Error('QUALITY_DIAGNOSTIC_VARIANT_INVALID');
  }
  return selected;
}

export function assertDiagnosticPhase(campaignId, phase) {
  if (campaignId.endsWith('-diagnostic') !== (phase === 'diagnostic')) {
    throw new Error('QUALITY_DIAGNOSTIC_PHASE_MISMATCH');
  }
}
