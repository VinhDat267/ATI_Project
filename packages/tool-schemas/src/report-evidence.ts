/**
 * Report Evidence contract and types (FLOW-01, F1 Grounding)
 * Under v3 specification & design authority.
 */

export type ReportKind =
  | 'github_prs'
  | 'github_issue_aging'
  | 'github_issues'
  | 'jira_progress'
  | 'sheet_summary'
  | 'sheets_summary';

export interface ReportEvidence {
  artifactId: string;
  kind: ReportKind;
  stepId: string;
  argument: 'text' | 'body' | 'content';
  sourceTool: string;
  sourceLabel: string;
  readAt: string;
  itemCount: number;
  coverage: 'complete' | 'partial';
  contentHash: string;
}

export interface ReportObservationRecord {
  id: string;
  kind: ReportKind;
  sourceTool: string;
  sourceLabel: string;
  actorUserId: string;
  workspaceId: string;
  items: unknown[];
  renderedText: string;
  contentHash: string;
  createdAt: string;
}
