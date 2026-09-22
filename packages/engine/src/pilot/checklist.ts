import { createHash } from 'node:crypto';
import type { SourceRow } from './source.js';

export const PILOT_CHECKLIST_VERSION = 'pilot-checklist-1';

export type ChecklistStatus = 'pass' | 'needs_input' | 'refusal';

export type ChecklistResult = {
  status: ChecklistStatus;
  checklistVersion: string;
  sourceRevision: string;
  missingFields: string[];
  conflicts: string[];
  unconfirmedBusiness: boolean;
  evidencePositions: Record<string, string>;
  summary: string;
};

export function computeSourceRevision(
  row: SourceRow,
  checklistVersion = PILOT_CHECKLIST_VERSION,
): string {
  const normalized = [
    checklistVersion,
    row.request_id,
    row.client_ref,
    row.request_type,
    row.raw_request,
    row.deliverable,
    row.due_date,
    row.decision_status,
    row.source_note,
  ];
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function isValidGregorianDate(dateStr: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  const maxDays = daysInMonth[month - 1];
  return maxDays !== undefined && day <= maxDays;
}

const CONFIRMED_STATUSES = new Set([
  'confirmed',
  'approved',
  'yes',
  'xác nhận',
  'đã duyệt',
  'chấp thuận',
]);

const CONFLICT_PATTERNS = [
  /chưa chốt/i,
  /mâu thuẫn/i,
  /conflict/i,
  /alternative\?/i,
  /\bhoặc\b.*\?/i,
  /\bcontradict/i,
];

export function evaluateChecklist(
  row: SourceRow,
  options?: { checklistVersion?: string },
): ChecklistResult {
  const checklistVersion = options?.checklistVersion ?? PILOT_CHECKLIST_VERSION;
  const sourceRevision = computeSourceRevision(row, checklistVersion);
  const missingFields: string[] = [];
  const conflicts: string[] = [];
  const evidencePositions: Record<string, string> = {};

  if (!row.client_ref || !row.client_ref.trim()) {
    missingFields.push('client_ref');
  } else {
    evidencePositions.client_ref = row.client_ref;
  }

  if (!row.raw_request || !row.raw_request.trim()) {
    missingFields.push('raw_request');
  } else {
    evidencePositions.raw_request = row.raw_request;
  }

  if (!row.deliverable || !row.deliverable.trim()) {
    missingFields.push('deliverable');
  } else {
    evidencePositions.deliverable = row.deliverable;
  }

  // Due date validation
  if (!row.due_date || !isValidGregorianDate(row.due_date)) {
    missingFields.push('due_date');
  } else {
    evidencePositions.due_date = row.due_date;
  }

  // Decision status validation
  const normStatus = row.decision_status ? row.decision_status.trim().toLowerCase() : '';
  const isConfirmed = CONFIRMED_STATUSES.has(normStatus);
  const unconfirmedBusiness = !isConfirmed;
  if (unconfirmedBusiness) {
    missingFields.push('decision_status');
  } else {
    evidencePositions.decision_status = row.decision_status;
  }

  // Type-specific requirements
  const combinedContext = `${row.raw_request} ${row.deliverable} ${row.source_note}`;

  if (row.request_type === 'web_change') {
    const hasTargetUrl =
      /https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\/[^\s]*|\/[a-zA-Z0-9_#-]+/i.test(
        combinedContext,
      );
    if (!hasTargetUrl) {
      missingFields.push('target_url');
    } else {
      evidencePositions.target_url = 'detected in request context';
    }
  } else if (row.request_type === 'design_asset') {
    const hasDimensions =
      /\b\d+\s*[xX*×]\s*\d+\b|\b\d+\s*(?:px|in|cm|mm|pt)\b|\b\d+:\d+\b/i.test(
        combinedContext,
      );
    if (!hasDimensions) {
      missingFields.push('dimensions');
    } else {
      evidencePositions.dimensions = 'detected in request context';
    }
  } else {
    return {
      status: 'refusal',
      checklistVersion,
      sourceRevision,
      missingFields: ['request_type'],
      conflicts: [],
      unconfirmedBusiness: true,
      evidencePositions,
      summary: `Unsupported request type: ${row.request_type}`,
    };
  }

  // Conflict detection
  for (const pattern of CONFLICT_PATTERNS) {
    const match = pattern.exec(combinedContext);
    if (match) {
      conflicts.push(`Detected conflict indicator: "${match[0]}"`);
    }
  }

  const hasIssues = missingFields.length > 0 || conflicts.length > 0 || unconfirmedBusiness;
  const status: ChecklistStatus = hasIssues ? 'needs_input' : 'pass';

  const summary =
    status === 'pass'
      ? `Checklist passed for ${row.request_type} (${row.request_id})`
      : `Checklist requires input for ${row.request_type} (${row.request_id}): ${missingFields.concat(conflicts).join(', ')}`;

  return {
    status,
    checklistVersion,
    sourceRevision,
    missingFields,
    conflicts,
    unconfirmedBusiness,
    evidencePositions,
    summary,
  };
}
