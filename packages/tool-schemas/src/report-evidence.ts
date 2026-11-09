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

export type ReportContentArgument = 'text' | 'body' | 'content' | 'desc' | 'description';

export type WorkItemReportChoice = 'report_content' | 'separate_content';

export interface WorkItemReportClarificationState {
  kind: 'work_item_report_disposition';
  status: 'pending';
  question: string;
  options: readonly [string, string];
  originalRequest: string;
}

export interface WorkItemReportResolution {
  status: 'unclarified' | 'resolved' | 'invalid_reply';
  choice?: WorkItemReportChoice;
  explicitTitle?: string;
  explicitBody?: string;
}

export const WORK_ITEM_REPORT_CLARIFICATION_QUESTION =
  'Bạn muốn nội dung công việc mới là báo cáo dữ liệu hay một nội dung riêng? Hãy tách hoặc xác nhận nội dung để tôi giữ đúng từng phần.';

export const WORK_ITEM_REPORT_CLARIFICATION_OPTIONS = [
  'Dùng báo cáo dữ liệu làm nội dung công việc mới',
  'Dùng nội dung riêng cho công việc mới',
] as const;

export const WORK_ITEM_REPORT_MEMORY_KEY = '__workItemReportClarification';

export interface ReportEvidence {
  artifactId: string;
  kind: ReportKind;
  stepId: string;
  argument: ReportContentArgument;
  sourceTool: string;
  sourceLabel: string;
  readAt: string;
  itemCount: number;
  coverage: 'complete' | 'partial';
  contentHash: string;
  workItemDisposition?: WorkItemReportChoice;
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

function foldVietnamese(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Original user context is authoritative; model-written summaries are only a fallback. */
export function requiresReportEvidence(userTexts: readonly string[]): boolean {
  const fold = foldVietnamese;
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

export const REPORT_SOURCE_TOOL_KINDS: Readonly<Record<string, ReportKind>> = {
  'github.list_pull_requests': 'github_prs',
  'github.list_issues': 'github_issues',
  'github.search_issues': 'github_issues',
  'myjira.search_issues': 'jira_progress',
  'jira.search_issues': 'jira_progress',
  'mysheets.read_range': 'sheets_summary',
  'mysheets.search_rows': 'sheets_summary',
  'mysheets.aggregate_rows': 'sheets_summary',
  'sheets.read_range': 'sheets_summary',
  'sheets.search_rows': 'sheets_summary',
  'sheets.aggregate_rows': 'sheets_summary',
};

export const REPORT_SOURCE_TOOLS: ReadonlySet<string> = new Set(
  Object.keys(REPORT_SOURCE_TOOL_KINDS),
);

const WORK_ITEM_TOOL_PATTERN = /^(?:github|myjira|jira|trello)\./;

export function isWorkItemWriteStep(step: { tool?: unknown } | null | undefined): boolean {
  return Boolean(
    step &&
      typeof step.tool === 'string' &&
      !REPORT_SOURCE_TOOLS.has(step.tool) &&
      WORK_ITEM_TOOL_PATTERN.test(step.tool),
  );
}

export function workItemContentArgument(tool: string): ReportContentArgument {
  if (tool.startsWith('trello.')) return 'desc';
  if (tool === 'jira.create_issue' || tool === 'myjira.create_issue') return 'description';
  return 'body';
}

export function workItemTitleArgument(tool: string): 'title' | 'summary' {
  if (tool === 'jira.create_issue' || tool === 'myjira.create_issue') return 'summary';
  return 'title';
}

/**
 * Extracts explicit user-authored title and body/description for a work item from user messages.
 */
export function extractExplicitWorkItemPayload(userTexts: readonly string[]): {
  explicitTitle?: string;
  explicitBody?: string;
} {
  let explicitTitle: string | undefined;
  let explicitBody: string | undefined;

  const titleRegex =
    /(?:với\s+|with\s+)?(?:tiêu\s+đề|tieu\s+de|title|summary|tên\s+thẻ|ten\s+the)\s*(?:là|la|is|:|=)?\s*(?:"([^"\n]+)"|“([^”\n]+)”|'([^'\n]+)')/giu;
  const bodyRegex =
    /(?:với\s+|with\s+|và\s+|and\s+|dùng\s+|use\s+)?(?:nội\s+dung(?:\s+riêng)?|noi\s+dung(?:\s+rieng)?|mô\s+tả|mo\s+ta|body|description|desc)\s*(?:cho\s+[^:"'“”\n]{1,40}\s*)?(?:là|la|is|:|=)?\s*(?:"([^"\n]+)"|“([^”\n]+)”|'([^'\n]+)')/giu;

  for (const text of userTexts) {
    for (const m of text.matchAll(titleRegex)) {
      const val = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (val) explicitTitle = val;
    }
    for (const m of text.matchAll(bodyRegex)) {
      const val = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (val) explicitBody = val;
    }
  }

  return { explicitTitle, explicitBody };
}

/**
 * Classifies a user's clarification reply into 'report_content' | 'separate_content' | null.
 */
export function classifyWorkItemClarificationReply(replyText: string): WorkItemReportChoice | null {
  const raw = replyText.replace(/^Original request:[\s\S]*?\nClarification answer:\s*/i, '').trim();
  if (!raw) return null;

  const folded = foldVietnamese(raw);
  const opt1Folded = foldVietnamese(WORK_ITEM_REPORT_CLARIFICATION_OPTIONS[0]);
  const opt2Folded = foldVietnamese(WORK_ITEM_REPORT_CLARIFICATION_OPTIONS[1]);

  if (raw === '1' || folded === opt1Folded) return 'report_content';
  if (raw === '2' || folded === opt2Folded) return 'separate_content';

  const wantsReport =
    /\b(?:dung\s+bao\s+cao|lay\s+bao\s+cao|bao\s+cao\s+du\s+lieu|noi\s+dung\s+(?:cong\s+viec\s+moi\s+)?la\s+bao\s+cao|gan\s+bao\s+cao|use\s+(?:the\s+)?(?:data\s+)?report|report\s+(?:data\s+)?as\s+(?:the\s+)?(?:content|body|description|issue|card))\b/i.test(
      folded,
    );
  const wantsSeparate =
    /\b(?:noi\s+dung\s+rieng|mot\s+noi\s+dung\s+rieng|dung\s+rieng|mo\s+ta\s+rieng|separate\s+(?:content|body|description)|custom\s+(?:content|body|description)|own\s+(?:content|body|description))\b/i.test(
      folded,
    );

  if (wantsReport && !wantsSeparate) return 'report_content';
  if (wantsSeparate && !wantsReport) return 'separate_content';
  return null;
}

/**
 * Resolves the work-item vs report disposition contract across Turn 1 and Turn 2+.
 */
export function resolveWorkItemReportClarification(params: {
  userMessage: string;
  groundingUserTexts: readonly string[];
  history?: ReadonlyArray<{ role: string; content: string }>;
  pendingState?: WorkItemReportClarificationState | null;
  hasDedicatedNotificationTarget: boolean;
}): WorkItemReportResolution {
  const { userMessage, groundingUserTexts, history = [], pendingState, hasDedicatedNotificationTarget } = params;
  const allTexts = groundingUserTexts.length > 0 ? groundingUserTexts : [userMessage];
  const { explicitTitle, explicitBody } = extractExplicitWorkItemPayload(allTexts);

  const historyHadClarification = history.some(
    (msg) =>
      msg.role === 'assistant' &&
      typeof msg.content === 'string' &&
      msg.content.includes('Bạn muốn nội dung công việc mới là báo cáo dữ liệu hay một nội dung riêng?'),
  );

  const isClarificationTurn = Boolean(pendingState && pendingState.status === 'pending') || historyHadClarification;

  if (isClarificationTurn) {
    const choice = classifyWorkItemClarificationReply(userMessage);
    if (!choice) {
      // Also allow a Turn 2 reply that directly supplies both explicit title and explicit body for the separate work item
      const replyPayload = extractExplicitWorkItemPayload([userMessage]);
      if (replyPayload.explicitTitle && replyPayload.explicitBody) {
        return {
          status: 'resolved',
          choice: 'separate_content',
          explicitTitle: replyPayload.explicitTitle,
          explicitBody: replyPayload.explicitBody,
        };
      }
      return { status: 'invalid_reply', explicitTitle, explicitBody };
    }
    return {
      status: 'resolved',
      choice,
      explicitTitle,
      explicitBody,
    };
  }

  // Turn 1: only auto-resolve as separate_content when there is a dedicated notification target
  // AND the user explicitly authored both a separate title and separate body for the work item.
  if (hasDedicatedNotificationTarget && explicitTitle && explicitBody) {
    return {
      status: 'resolved',
      choice: 'separate_content',
      explicitTitle,
      explicitBody,
    };
  }

  return {
    status: 'unclarified',
    explicitTitle,
    explicitBody,
  };
}

/** Every content field in a report must be bound, including references and earlier writes. */
export function reportOutputTargets(
  steps: readonly { id: string; tool: string; args: Record<string, unknown> }[],
  options?: {
    userTexts?: readonly string[];
    workItemChoice?: WorkItemReportChoice;
  },
): Array<{ stepId: string; argument: ReportContentArgument }> {
  const candidateArgs: readonly ReportContentArgument[] = ['text', 'body', 'content', 'desc', 'description'];
  const allTargets = steps.flatMap((step) =>
    !step || typeof step.tool !== 'string' || REPORT_SOURCE_TOOLS.has(step.tool)
      ? []
      : candidateArgs
          .filter((argument) => Object.hasOwn(step.args ?? {}, argument))
          .map((argument) => ({ stepId: step.id, argument, tool: step.tool, value: step.args?.[argument] })),
  );

  const nonWorkItemTargets = allTargets.filter((target) => !WORK_ITEM_TOOL_PATTERN.test(target.tool));
  if (nonWorkItemTargets.length === 0) {
    return allTargets.map(({ stepId, argument }) => ({ stepId, argument }));
  }

  // Determined choice from options or from the latest user text in userTexts
  const inferredChoice =
    options?.workItemChoice ??
    (options?.userTexts && options.userTexts.length > 0
      ? classifyWorkItemClarificationReply(options.userTexts.at(-1) ?? '') ?? undefined
      : undefined);

  if (inferredChoice === 'report_content') {
    return allTargets.map(({ stepId, argument }) => ({ stepId, argument }));
  }

  const { explicitBody } = extractExplicitWorkItemPayload(options?.userTexts ?? []);

  return allTargets
    .filter((target) => {
      if (!WORK_ITEM_TOOL_PATTERN.test(target.tool)) {
        return true;
      }
      // A work-item step's content field is only exempt from reportEvidence hash binding when
      // the user explicitly authored that exact separate body in userTexts.
      if (
        explicitBody !== undefined &&
        typeof target.value === 'string' &&
        target.value.trim() === explicitBody.trim()
      ) {
        return false;
      }
      return true;
    })
    .map(({ stepId, argument }) => ({ stepId, argument }));
}
