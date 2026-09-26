import { createHash } from 'node:crypto';
import type { SourceRow } from './source.js';

export const PILOT_CHECKLIST_VERSION = 'pilot-checklist-3';

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

// Assignment is not supported by the fixed pilot card path: it cannot verify
// a member ID against the board or bind that member to the approval snapshot.
// Treat explicit assignment requests as incomplete instead of creating an
// unassigned card that appears to fulfil them.
const ASSIGNMENT_PATTERNS = [
  /\bgiao\s+(?:việc\s+)?cho\b/iu,
  /\bphân\s+công\b/iu,
  /\bngười\s+(?:được\s+)?(?:giao|phụ\s+trách)\b/iu,
  /\bphụ\s+trách\b/iu,
  /\bassign(?:ed)?\b/iu,
  /\bassignee\b/iu,
  /\bassignee_id\b/iu,
  /\bassigned_to\b/iu,
  /\bowner\s*:/iu,
  /\bresponsible\s+for\b/iu,
  /\bnhờ[\s\S]{0,100}\bthực\s+hiện\b/iu,
  /\bwill\s+handle\b/iu,
];

export function requiresVerifiedAssignee(text: string): boolean {
  return ASSIGNMENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function applyAssignmentGate(
  row: SourceRow,
  operatorPrompt: string,
  checklist: ChecklistResult,
): ChecklistResult {
  const context = `${row.raw_request}\n${row.deliverable}\n${row.source_note}\n${operatorPrompt}`;
  if (!requiresVerifiedAssignee(context) || checklist.missingFields.includes('assignee_id')) {
    return checklist;
  }
  const missingFields = [...checklist.missingFields, 'assignee_id'];
  return {
    ...checklist,
    status: checklist.status === 'refusal' ? 'refusal' : 'needs_input',
    missingFields,
    summary: `Checklist requires input for ${row.request_type} (${row.request_id}): ${missingFields.concat(checklist.conflicts).join(', ')}`,
  };
}

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

  if (requiresVerifiedAssignee(combinedContext)) {
    missingFields.push('assignee_id');
  }

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
      /\bA4\b|\b\d+\s*[xX*×]\s*\d+\b|\b\d+\s*(?:px|in|cm|mm|pt)\b|\b\d+:\d+\b/i.test(
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
