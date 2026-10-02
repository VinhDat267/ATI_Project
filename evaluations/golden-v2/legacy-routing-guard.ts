import exceptions from './routing-exceptions.json';

export interface RoutingRow {
  id: string;
  source: string;
  legacyCatalog: string[];
  prompt?: string;
  expectedKind?: string;
  fullCatalog?: string[];
}

export interface RoutingContext {
  registeredServiceIds: string[];
  legacyCatalogServiceIds: string[];
}

function isApprovedRefusal(row: RoutingRow, context?: RoutingContext): boolean {
  if (!context) return false;
  return exceptions.some(exception =>
    row.source === exception.source && row.id === exception.id &&
    row.prompt === exception.prompt && row.expectedKind === exception.expectedKind &&
    context.registeredServiceIds.includes(exception.service) &&
    !context.legacyCatalogServiceIds.includes(exception.service) &&
    row.fullCatalog?.length === 1 && row.fullCatalog[0] === exception.service,
  );
}

/** The original 50 + 18 requests all had nonempty routing with the three-service catalog. */
export function legacyRoutingFailures(actual: RoutingRow[], context?: RoutingContext): string[] {
  // Never derive the invariant from the updateable comparison snapshot.
  // Exceptions bind the approved prompt/label to a registered but unavailable service.
  return actual.filter(row => (row.source === 'golden' || row.source === 'freeform') &&
    row.legacyCatalog.length === 0 && !isApprovedRefusal(row, context))
    .map(row => row.source + ':' + row.id);
}
