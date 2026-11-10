/**
 * Deterministic Report Renderers (FLOW-01 & FLOW-05, F1 Grounding)
 * Generates factual notification text strictly from verified read observations.
 */

import type { ReportKind } from '@wap/tool-schemas';

export interface GitHubPullRequestItem {
  number: number;
  title: string;
  url?: string;
  /** Compatibility with older saved fixtures; native adapters return url. */
  html_url?: string;
  state?: string;
}

export interface GitHubIssueItem {
  id?: string | number;
  number: number;
  title: string;
  url: string;
  repo?: string;
  createdAt?: string;
  updatedAt?: string;
  state?: string;
}

export interface JiraIssueItem {
  key: string;
  title: string;
  status: string;
  url?: string;
  issueType?: string;
  priority?: string;
  assignee?: string | null;
}

export interface SheetSummaryRow {
  [key: string]: unknown;
}

export interface SheetSummaryData {
  records?: SheetSummaryRow[];
  headers?: string[];
  values?: (string | number | null | undefined)[][];
  groups?: Array<{ key: string | Record<string, unknown>; count: number; metrics?: Record<string, number> }>;
  totalRowsScanned?: number;
  matchedRows?: number;
  totalMatched?: number;
  truncated?: boolean;
  matches?: Array<{
    rowNumber?: number;
    values?: (string | number | null | undefined)[];
    record?: SheetSummaryRow;
  }>;
  totals?: Record<string, number>;
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
 * Robust number parsing supporting:
 * - US format: "1,234.56", "$1,234.50", "1234.5"
 * - VN format: "1.234,56", "1.234,50 ₫", "500.000 VND", "12,5"
 * - Negative numbers: "-100.50", "- 1.234,50", "(500)", "(1,250.75)"
 * Returns null if input is not a finite number.
 */
export function parseFactualNumber(input: unknown): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : null;
  }
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;

  let isNegative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    isNegative = true;
    s = s.slice(1, -1).trim();
  } else if (s.startsWith('-')) {
    isNegative = true;
    s = s.slice(1).trim();
  }

  // Remove currency signs & words
  s = s.replace(/[₫$€£¥]|VND|USD|EUR/gi, '').trim();

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    if (lastComma > lastDot) {
      // VN format: 1.234.567,89 -> remove dots, replace comma with dot
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 1,234,567.89 -> remove commas
      s = s.replace(/,/g, '');
    }
  } else if (lastComma !== -1 && lastDot === -1) {
    // Only comma present
    const parts = s.split(',');
    if (parts.length === 2 && parts[1] !== undefined && parts[1].length !== 3) {
      s = s.replace(',', '.');
    } else if (parts.length > 2) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(',', '.');
    }
  } else if (lastDot !== -1 && lastComma === -1) {
    // Only dot present
    const parts = s.split('.');
    if (parts.length > 2) {
      s = s.replace(/\./g, '');
    } else if (
      parts.length === 2 &&
      parts[0] !== undefined &&
      parts[1] !== undefined &&
      parts[1].length === 3 &&
      parts[0].length <= 3 &&
      !s.includes('e')
    ) {
      // e.g. 500.000 in VN
      s = s.replace(/\./g, '');
    }
  }

  const val = Number.parseFloat(s);
  if (Number.isNaN(val) || !Number.isFinite(val)) return null;
  return isNegative ? -val : val;
}

/**
 * Format numbers by locale (VN or US)
 */
export function formatFactualNumber(val: number, locale: 'vi' | 'en' = 'vi'): string {
  return val.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US', {
    maximumFractionDigits: 2,
  });
}

/**
 * Deterministically renders a GitHub Pull Requests report.
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
      const url = pr.url ?? pr.html_url;
      if (typeof url !== 'string' || !url) throw new Error('Missing verified PR URL');
      return `- #${num}: ${title} (${url})`;
    }),
  ];

  return {
    text: lines.join('\n'),
    itemCount: count,
    coverage: isPartial ? 'partial' : 'complete',
  };
}

/**
 * Deterministically renders a GitHub Issue Aging report (DEV-04).
 */
export function renderGithubIssueAgingReport(
  issues: GitHubIssueItem[],
  options?: {
    repo?: string;
    agingDays?: number;
    clock?: string | Date;
    limit?: number;
  }
): RenderedReport {
  if (!Array.isArray(issues)) {
    throw new Error('Invalid Issues read outcome: expected an array of GitHub issue items');
  }

  const repoLabel = options?.repo ? ` (${options.repo})` : '';
  const agingDays = options?.agingDays ?? 7;
  const referenceTime = options?.clock
    ? typeof options.clock === 'string'
      ? Date.parse(options.clock)
      : options.clock.getTime()
    : Date.now();

  const evaluated = issues.map((iss) => {
    const rawTime = iss.createdAt || iss.updatedAt;
    const timeMs = rawTime ? Date.parse(rawTime) : null;
    const ageDays = timeMs !== null && !Number.isNaN(timeMs)
      ? Math.max(0, Math.floor((referenceTime - timeMs) / 86400000))
      : null;
    return { ...iss, ageDays };
  });

  const agingIssues = evaluated
    .filter((iss) => iss.ageDays !== null && iss.ageDays >= agingDays)
    .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));

  const limit = options?.limit ?? agingIssues.length;
  const itemsToRender = agingIssues.slice(0, limit);
  const isPartial = agingIssues.length > itemsToRender.length;
  const count = agingIssues.length;

  if (count === 0) {
    return {
      text: `Báo cáo GitHub Issue tồn đọng${repoLabel}: Hiện không có issue nào tồn đọng quá ${agingDays} ngày (ngưỡng đối chiếu: ${agingDays} ngày).`,
      itemCount: 0,
      coverage: 'complete',
    };
  }

  const lines = [
    `Báo cáo GitHub Issue tồn đọng${repoLabel}: Hiện có ${count} issue tồn đọng quá ${agingDays} ngày (trong tổng số ${issues.length} issue đã kiểm tra)${isPartial ? ` (hiển thị ${itemsToRender.length} mục đầu tiên)` : ''}:`,
    ...itemsToRender.map((iss) => {
      const num = iss.number;
      const title = sanitizeReportString(iss.title);
      const url = iss.url;
      const age = iss.ageDays;
      return `- #${num}: ${title} (tuổi: ${age} ngày) (${url})`;
    }),
  ];

  return {
    text: lines.join('\n'),
    itemCount: count,
    coverage: isPartial ? 'partial' : 'complete',
  };
}

/**
 * Deterministically renders a Jira Sprint progress report (PM-03).
 */
export function renderJiraProgressReport(
  issues: JiraIssueItem[],
  options?: {
    projectKey?: string;
    sprintName?: string;
    limit?: number;
  }
): RenderedReport {
  if (!Array.isArray(issues)) {
    throw new Error('Invalid Jira issues outcome: expected an array of issue items');
  }

  const projectLabel = options?.projectKey ? ` - ${options.projectKey}` : '';
  const sprintLabel = options?.sprintName
    ? ` (${options.sprintName}${projectLabel})`
    : options?.projectKey
    ? ` (${options.projectKey})`
    : '';

  const count = issues.length;
  if (count === 0) {
    return {
      text: `Báo cáo tiến độ Jira Sprint${sprintLabel}: Hiện không có ticket nào trong Sprint.`,
      itemCount: 0,
      coverage: 'complete',
    };
  }

  // Count by status
  const statusCounts: Record<string, number> = {};
  for (const iss of issues) {
    const st = sanitizeReportString(iss.status) || 'Chưa phân loại';
    statusCounts[st] = (statusCounts[st] ?? 0) + 1;
  }

  const statusSummary = Object.entries(statusCounts)
    .map(([st, c]) => `${st}: ${c}`)
    .join(', ');

  const limit = options?.limit ?? 15;
  const itemsToRender = issues.slice(0, limit);
  const isPartial = count > itemsToRender.length;

  const lines = [
    `Báo cáo tiến độ Jira Sprint${sprintLabel}: Tổng số ${count} ticket. (Duyệt từng lượt trước khi gửi - Manual Approval Required)`,
    `Trạng thái: ${statusSummary}`,
    ...itemsToRender.map((iss) => {
      const key = sanitizeReportString(iss.key);
      const title = sanitizeReportString(iss.title);
      const status = sanitizeReportString(iss.status);
      const urlPart = iss.url ? ` (${iss.url})` : '';
      return `- [${key}] ${title} (${status})${urlPart}`;
    }),
  ];

  if (isPartial) {
    lines.push(`(hiển thị ${itemsToRender.length}/${count} ticket đầu tiên)`);
  }

  return {
    text: lines.join('\n'),
    itemCount: count,
    coverage: isPartial ? 'partial' : 'complete',
  };
}

/**
 * Deterministically renders a Google Sheets summary report (OFF-03).
 */
export function renderSheetSummaryReport(
  data: SheetSummaryData,
  options?: {
    spreadsheetTitle?: string;
    sheetName?: string;
    groupBy?: string;
    metricColumn?: string;
    locale?: 'vi' | 'en';
    limit?: number;
  }
): RenderedReport {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid Sheet summary outcome: expected an object containing records, values or groups');
  }

  const locale = options?.locale ?? 'vi';
  const spreadsheetLabel = options?.spreadsheetTitle
    ? ` (${options.spreadsheetTitle}${options.sheetName ? ` - ${options.sheetName}` : ''})`
    : '';

  // Case 1: Pre-aggregated groups (from aggregate_rows)
  if (Array.isArray(data.groups)) {
    if (
      data.totalRowsScanned !== undefined &&
      (typeof data.totalRowsScanned !== 'number' || !Number.isFinite(data.totalRowsScanned) || data.totalRowsScanned < 0)
    ) {
      throw new Error('Inconsistent Sheet aggregation outcome: totalRowsScanned must be a non-negative number');
    }
    if (
      data.matchedRows !== undefined &&
      (typeof data.matchedRows !== 'number' || !Number.isFinite(data.matchedRows) || data.matchedRows < 0)
    ) {
      throw new Error('Inconsistent Sheet aggregation outcome: matchedRows must be a non-negative number');
    }
    for (const g of data.groups) {
      if (!g || typeof g !== 'object' || typeof g.count !== 'number' || !Number.isFinite(g.count) || g.count < 0) {
        throw new Error('Inconsistent Sheet aggregation outcome: each group must have a non-negative numeric count');
      }
    }

    const groupCountSum = data.groups.reduce((acc, g) => acc + g.count, 0);
    if (
      data.totalRowsScanned !== undefined &&
      data.matchedRows !== undefined &&
      data.matchedRows > data.totalRowsScanned
    ) {
      throw new Error('Inconsistent Sheet aggregation outcome: matchedRows exceeds totalRowsScanned');
    }
    if (data.matchedRows !== undefined && groupCountSum > data.matchedRows) {
      throw new Error('Inconsistent Sheet aggregation outcome: sum of group counts exceeds matchedRows');
    }
    if (data.totalRowsScanned !== undefined && groupCountSum > data.totalRowsScanned) {
      throw new Error('Inconsistent Sheet aggregation outcome: sum of group counts exceeds totalRowsScanned');
    }
    if ((data.matchedRows ?? 0) > 0 && data.groups.length === 0) {
      throw new Error('Inconsistent Sheet aggregation outcome: matchedRows > 0 but groups array is empty');
    }

    const matchedTotal = data.matchedRows ?? groupCountSum;
    if (matchedTotal === 0) {
      return {
        text: `Báo cáo tổng hợp số liệu Google Sheets${spreadsheetLabel}: Không có dòng dữ liệu nào.`,
        itemCount: 0,
        coverage: 'complete',
      };
    }

    const isPartial = Boolean(data.truncated) || groupCountSum < matchedTotal;
    const countHeader =
      data.totalRowsScanned !== undefined && data.totalRowsScanned !== matchedTotal
        ? `Tổng số dòng đã quét: ${data.totalRowsScanned} | Số dòng khớp: ${matchedTotal} | Tổng số dòng đã đối chiếu: ${groupCountSum}${isPartial ? ` (dữ liệu một phần: tổng hợp ${groupCountSum}/${matchedTotal} dòng khớp)` : ''}`
        : `Tổng số dòng đã đối chiếu: ${matchedTotal}${isPartial ? ` (dữ liệu một phần: tổng hợp ${groupCountSum}/${matchedTotal} dòng khớp)` : ''}`;

    const lines = [
      `Báo cáo tổng hợp số liệu Google Sheets${spreadsheetLabel}:`,
      countHeader,
      ...data.groups.map((g) => {
        const rawKey =
          typeof g.key === 'string'
            ? g.key
            : g.key && typeof g.key === 'object'
              ? Object.values(g.key)
                  .map((v) => sanitizeReportString(String(v ?? '')))
                  .filter(Boolean)
                  .join(' / ')
              : String(g.key ?? '');
        const key = sanitizeReportString(rawKey) || 'Khác';
        const pct = matchedTotal > 0 ? Math.round((g.count / matchedTotal) * 100) : 0;
        const metricEntries =
          g.metrics && typeof g.metrics === 'object'
            ? Object.entries(g.metrics)
                .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
                .map(([k, v]) => `${sanitizeReportString(k)}: ${formatFactualNumber(v, locale)}`)
            : [];
        const metricSuffix = metricEntries.length > 0 ? ` [${metricEntries.join(', ')}]` : '';
        return `- ${key}: ${g.count} (${pct}%)${metricSuffix}`;
      }),
    ];

    return {
      text: lines.join('\n'),
      itemCount: matchedTotal,
      coverage: isPartial ? 'partial' : 'complete',
    };
  }

  // Case 2: Array of records, matches (from search_rows), or values
  if (
    data.totalMatched !== undefined &&
    (typeof data.totalMatched !== 'number' || !Number.isFinite(data.totalMatched) || data.totalMatched < 0)
  ) {
    throw new Error('Inconsistent Sheet search outcome: totalMatched must be a non-negative number');
  }
  if (
    data.totalRowsScanned !== undefined &&
    (typeof data.totalRowsScanned !== 'number' || !Number.isFinite(data.totalRowsScanned) || data.totalRowsScanned < 0)
  ) {
    throw new Error('Inconsistent Sheet summary outcome: totalRowsScanned must be a non-negative number');
  }

  let rows: SheetSummaryRow[] = [];
  if (Array.isArray(data.records)) {
    rows = data.records;
  } else if (Array.isArray(data.matches)) {
    if (data.totalMatched !== undefined && data.totalMatched < data.matches.length) {
      throw new Error('Inconsistent Sheet search outcome: totalMatched cannot be less than matches.length');
    }
    if (data.totalMatched !== undefined && data.totalMatched > 0 && data.matches.length === 0) {
      throw new Error('Inconsistent Sheet search outcome: totalMatched > 0 but matches array is empty');
    }
    if (
      data.totalRowsScanned !== undefined &&
      data.totalMatched !== undefined &&
      data.totalMatched > data.totalRowsScanned
    ) {
      throw new Error('Inconsistent Sheet search outcome: totalMatched exceeds totalRowsScanned');
    }
    rows = data.matches.map((m) => {
      if (m && typeof m === 'object' && m.record && typeof m.record === 'object' && !Array.isArray(m.record)) {
        return m.record;
      }
      if (m && typeof m === 'object' && Array.isArray(m.values) && Array.isArray(data.headers)) {
        const obj: SheetSummaryRow = {};
        data.headers.forEach((h, idx) => {
          obj[h] = m.values?.[idx];
        });
        return obj;
      }
      throw new Error('Inconsistent Sheet search outcome: match item missing both record and header-mapped values');
    });
  } else if (Array.isArray(data.values) && Array.isArray(data.headers)) {
    const headers = data.headers;
    rows = data.values.map((row) => {
      const obj: SheetSummaryRow = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx];
      });
      return obj;
    });
  } else if (Array.isArray(data.values) && data.values.length > 0) {
    throw new Error('Sheet headers required: read with headerAware=true before rendering a factual summary');
  } else if (!Array.isArray(data.values)) {
    throw new Error('Invalid Sheet summary outcome: missing records, values or groups');
  }

  const returnedCount = rows.length;
  const matchedCount = data.totalMatched ?? data.matchedRows ?? returnedCount;
  if (matchedCount < returnedCount) {
    throw new Error('Inconsistent Sheet summary outcome: matchedCount cannot be less than returned rows length');
  }
  if (matchedCount > 0 && returnedCount === 0) {
    throw new Error('Inconsistent Sheet summary outcome: matchedCount > 0 but no rows were returned');
  }
  if (matchedCount === 0) {
    return {
      text: `Báo cáo tổng hợp số liệu Google Sheets${spreadsheetLabel}: Không có dòng dữ liệu nào.`,
      itemCount: 0,
      coverage: 'complete',
    };
  }

  const limit = options?.limit ?? 10;
  const isRowListMode = !options?.groupBy && !options?.metricColumn;
  const itemsToRender = isRowListMode ? rows.slice(0, limit) : rows;
  const displayedCount = itemsToRender.length;
  const isPartial =
    Boolean(data.truncated) ||
    matchedCount > returnedCount ||
    (isRowListMode && returnedCount > displayedCount);

  const lines = [
    `Báo cáo tổng hợp số liệu Google Sheets${spreadsheetLabel}:`,
    `Tổng số dòng đã đối chiếu: ${matchedCount}`,
  ];
  if (data.totalRowsScanned !== undefined && data.totalRowsScanned !== matchedCount) {
    lines.push(`Tổng số dòng đã quét: ${data.totalRowsScanned}`);
  }
  if (isPartial) {
    lines.push(
      `(Phạm vi một phần / partial: khớp ${matchedCount} dòng, trả về ${returnedCount} dòng, hiển thị ${displayedCount} dòng đầu tiên)`,
    );
  }

  // Grouping by column if requested
  if (options?.groupBy) {
    const groupKey = options.groupBy;
    const groupCounts: Record<string, number> = {};
    for (const r of rows) {
      const rawVal = r[groupKey];
      const sanitizedKey = sanitizeReportString(rawVal) || 'Chưa phân loại';
      groupCounts[sanitizedKey] = (groupCounts[sanitizedKey] ?? 0) + 1;
    }

    for (const [k, c] of Object.entries(groupCounts)) {
      const pct = Math.round((c / returnedCount) * 100);
      lines.push(`- ${k}: ${c} (${pct}%)`);
    }
  }

  // Summing metric if requested
  if (options?.metricColumn) {
    const metricKey = options.metricColumn;
    let sum = 0;
    let validCount = 0;
    for (const r of rows) {
      const num = parseFactualNumber(r[metricKey]);
      if (num !== null) {
        sum += num;
        validCount++;
      }
    }
    if (validCount > 0) {
      lines.push(`- Tổng ${sanitizeReportString(metricKey)}: ${formatFactualNumber(sum, locale)}`);
    }
  }

  // When no grouping or metric column is requested (e.g. search_rows or plain read_range summary), render verified row summaries
  if (isRowListMode) {
    for (const r of itemsToRender) {
      const parts = Object.entries(r)
        .map(([k, v]) => {
          const sk = sanitizeReportString(k);
          const sv = sanitizeReportString(v === null || v === undefined ? '' : String(v));
          return sk && sv ? `${sk}: ${sv}` : '';
        })
        .filter(Boolean);
      if (parts.length > 0) {
        lines.push(`- ${parts.join(' | ')}`);
      }
    }
  }

  return {
    text: lines.join('\n'),
    itemCount: matchedCount,
    coverage: isPartial ? 'partial' : 'complete',
  };
}
