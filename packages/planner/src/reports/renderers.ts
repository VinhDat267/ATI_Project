/**
 * Deterministic Report Renderers (FLOW-01, F1 Grounding)
 * Generates factual notification text strictly from verified read observations.
 */

import type { ReportKind } from '@wap/tool-schemas';

export interface GitHubPullRequestItem {
  number: number;
  title: string;
  html_url: string;
  state?: string;
}

export interface RenderedReport {
  text: string;
  itemCount: number;
  coverage: 'complete' | 'partial';
}

/**
 * Sanitizes external strings (e.g. PR titles, issue subjects) to prevent prompt injection,
 * markdown escaping breaks, or disguised instructions from entering notification channels.
 */
export function sanitizeReportString(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[<>`]/g, '')
    .trim()
    .slice(0, 300);
}

/**
 * Deterministically renders a GitHub Pull Requests report.
 * Throws if the input is not a valid array, ensuring read errors never become '0 PRs'.
 */
export function renderGithubPrsReport(
  prs: GitHubPullRequestItem[],
  options?: { repo?: string; limit?: number }
): RenderedReport {
  if (!Array.isArray(prs)) {
    throw new Error('Invalid PRs read outcome: expected an array of pull request items');
  }

  const repoLabel = options?.repo ? ` (${options.repo})` : '';
  const limit = options?.limit ?? prs.length;
  const itemsToRender = prs.slice(0, limit);
  const isPartial = prs.length > itemsToRender.length;
  const count = prs.length;

  if (count === 0) {
    return {
      text: `Báo cáo Pull Request${repoLabel}: Hiện không có Pull Request nào đang mở.`,
      itemCount: 0,
      coverage: 'complete',
    };
  }

  const lines = [
    `Báo cáo Pull Request${repoLabel}: Hiện có ${count} Pull Request đang mở${isPartial ? ` (hiển thị ${itemsToRender.length} mục đầu tiên)` : ''}:`,
    ...itemsToRender.map((pr) => {
      const num = pr.number;
      const title = sanitizeReportString(pr.title);
      const url = pr.html_url;
      return `- #${num}: ${title} (${url})`;
    }),
  ];

  return {
    text: lines.join('\n'),
    itemCount: count,
    coverage: isPartial ? 'partial' : 'complete',
  };
}
