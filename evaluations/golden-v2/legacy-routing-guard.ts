export interface RoutingRow { id: string; source: string; legacyCatalog: string[] }

/** The original 50 + 18 requests all had nonempty routing with the three-service catalog. */
export function legacyRoutingFailures(actual: RoutingRow[]): string[] {
  // Never derive the invariant from the updateable comparison snapshot.
  return actual.filter(row => (row.source === 'golden' || row.source === 'freeform') && row.legacyCatalog.length === 0)
    .map(row => row.source + ':' + row.id);
}
