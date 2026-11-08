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

/** Original user context is authoritative; model-written summaries are only a fallback. */
export function requiresReportEvidence(userTexts: readonly string[]): boolean {
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const topic = /\b(?:prs?|pull requests?|issues?|jira|sprints?|sheets?|spreadsheets?|bang tinh|so lieu|ban phat hanh|cac thay doi)\b/;
  const report = /\b(?:bao cao|tong hop|thong ke|tom tat|reports?|digest|summary|summari[sz]e|progress|aging)\b/;
  const read = /\b(?:danh sach|liet ke|doc|xem|kiem tra|lay|dem|bao nhieu|may|hien co|co nhung|tim|list|read|show|find|fetch|which|how many|what)\b/;
  const send = /(?<![\p{L}\p{N}_])(?:gửi|nhắn|gui|send|post|notify)(?![\p{L}\p{N}_])/iu;
  const sourceMutation = /\b(?:tao|them|ghi|cap nhat|sua|dong|gan|mo|create|add|append|update|close|assign|delete)\s+(?:(?:moi|mot|cac|a|an|the|new|github|google|nhan|bug|cho)\s+)*(?:prs?|pull requests?|issues?|tickets?|jira|sprints?|sheets?|spreadsheets?|bang tinh|dong|rows?|cells?|the|cards?|trello)\b/;
  const latest = fold(userTexts.at(-1) ?? '');
  const outsideQuotes = latest.replace(/"[^"\n]*"|“[^”\n]*”|'[^'\n]*'/g, '');
  // A user may send their own literal words, including numbers or the word "report".
  if (send.test(userTexts.at(-1) ?? '') && (outsideQuotes !== latest || /\b(?:nguyen van|verbatim|literal)\b/.test(latest)) &&
      !(report.test(outsideQuotes) || read.test(outsideQuotes))) return false;
  return userTexts.some((text) => {
    let value = fold(text);
    if (!topic.test(value)) return false;
    // A title/body is authored payload, not a second requested action. Keep any
    // subsequent action clause so "create issue; summarize PRs" still needs evidence.
    const payload = /\b(?:with\s+)?(?:title|body|description|tieu de|noi dung|mo ta)\s*[:=]?\s*/.exec(value);
    if (payload) {
      const tail = value.slice(payload.index + payload[0].length);
      const nextAction = /(?:[.;!?]\s*|\b(?:and|then|va|roi)\s+)(?=(?:gui|send|post|notify|bao cao|tong hop|thong ke|tom tat|report|summari[sz]e|dem|count|list|find|read)\b)/.exec(tail);
      value = value.slice(0, payload.index) + (nextAction ? tail.slice(nextAction.index) : '');
    }
    const mutation = sourceMutation.exec(value);
    if (mutation) {
      const before = value.slice(0, mutation.index);
      const after = value.slice(mutation.index + mutation[0].length);
      const separateReport = /(?:^|[.;!?]\s*|\b(?:va|roi|and|then|de)\s+)(?:(?:gui|send|post)\s+(?:a\s+)?)?(?:bao cao|tong hop|thong ke|tom tat|reports?|digest|summary|summari[sz]e|dem|count|danh sach|list)\b/;
      return (topic.test(before) && report.test(before)) || separateReport.test(before) || separateReport.test(after);
    }
    // Reading a contact table solely to address an ordinary email is not a data report.
    if (!report.test(value) && !/\b(?:dem|bao nhieu|tong so|ket qua|count|results?|how many)\b/.test(value) && /\b(?:khach hang|dia chi|nguoi nhan|recipients?|contacts?)\b/.test(value) &&
        /\b(?:gui email|send (?:an? )?email)\b/.test(value)) return false;
    return report.test(value) || read.test(value) || send.test(text);
  });
}

/** Detect literal instructions so a mixed report request can clarify before any write. */
export function reportLiteralBodies(userTexts: readonly string[]): string[] {
  return userTexts.flatMap(text => [...text.matchAll(/(?:nguyên văn|verbatim|literal|exact(?:ly)?(?: this)?(?: message| text)?)[^"'“”\n]{0,48}(?:"([^"\n]*)"|“([^”\n]*)”|'([^'\n]*)')/giu)]
    .map(match => match[1] ?? match[2] ?? match[3] ?? ''));
}

export const REPORT_SOURCE_TOOLS: ReadonlySet<string> = new Set([
  'github.list_pull_requests', 'github.list_issues', 'github.search_issues', 'myjira.search_issues', 'jira.search_issues',
  'mysheets.read_range', 'mysheets.aggregate_rows', 'sheets.read_range',
]);

/** Every content field in a report must be bound, including references and earlier writes. */
export function reportOutputTargets(steps: readonly { id: string; tool: string; args: Record<string, unknown> }[]) {
  return steps.flatMap((step) => !step || typeof step.tool !== 'string' || REPORT_SOURCE_TOOLS.has(step.tool) ? [] :
    (['text', 'body', 'content'] as const).filter((argument) => Object.hasOwn(step.args ?? {}, argument))
      .map((argument) => ({ stepId: step.id, argument })));
}
