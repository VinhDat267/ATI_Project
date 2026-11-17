export type SlackBlock = Record<string, unknown>;

export const SLACK_MAX_BLOCKS = 50;
export const SLACK_HEADER_MAX_CHARS = 150;
export const SLACK_SECTION_MAX_CHARS = 3000;
export const SLACK_CONTEXT_MAX_CHARS = 2000;
export const SLACK_BUTTON_LABEL_MAX_CHARS = 75;

function truncateCodepoints(input: string, max: number): string {
  const chars = Array.from(input.trim());
  if (chars.length <= max) return chars.join('');
  if (max <= 1) return chars.slice(0, max).join('');
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

function splitMrkdwnChunks(text: string, maxChars = SLACK_SECTION_MAX_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const chunks: string[] = [];
  let currentLines: string[] = [];
  let currentLen = 0;

  const pushCurrent = () => {
    if (currentLines.length > 0) {
      chunks.push(currentLines.join('\n'));
      currentLines = [];
      currentLen = 0;
    }
  };

  for (const rawLine of trimmed.split('\n')) {
    if (rawLine.length > maxChars) {
      pushCurrent();
      for (let i = 0; i < rawLine.length; i += maxChars) {
        const slice = rawLine.slice(i, i + maxChars).trimEnd();
        if (slice) chunks.push(slice);
      }
      continue;
    }
    const addedLen = currentLines.length === 0 ? rawLine.length : currentLen + 1 + rawLine.length;
    if (addedLen > maxChars) {
      pushCurrent();
    }
    currentLines.push(rawLine);
    currentLen = currentLines.length === 1 ? rawLine.length : currentLen + 1 + rawLine.length;
  }
  pushCurrent();
  return chunks;
}

export interface SlackDigestBlockSection {
  heading?: string;
  body: string;
}

export interface BuildSlackDigestBlocksInput {
  headerTitle: string;
  subtitle?: string;
  sections: SlackDigestBlockSection[];
  footer?: string;
  actionButton?: { label: string; url: string };
}

function isSafeHttpsUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('https://')) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Formats structured digest sections into Slack Block Kit blocks respecting
 * Slack limits (<= 50 blocks, <= 150 header chars, <= 3000 section chars, https action links only).
 */
export function buildSlackDigestBlocks(input: BuildSlackDigestBlocksInput): SlackBlock[] {
  const topBlocks: SlackBlock[] = [];
  const header = truncateCodepoints(input.headerTitle, SLACK_HEADER_MAX_CHARS);
  if (header) {
    topBlocks.push({
      type: 'header',
      text: { type: 'plain_text', text: header, emoji: true },
    });
  }
  const subtitle = input.subtitle ? truncateCodepoints(input.subtitle, SLACK_CONTEXT_MAX_CHARS) : '';
  if (subtitle) {
    topBlocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: subtitle }],
    });
  }
  topBlocks.push({ type: 'divider' });

  const tailBlocks: SlackBlock[] = [];
  const footer = input.footer ? truncateCodepoints(input.footer, SLACK_CONTEXT_MAX_CHARS) : '';
  if (footer) {
    tailBlocks.push({ type: 'divider' });
    tailBlocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: footer }],
    });
  }
  if (input.actionButton && isSafeHttpsUrl(input.actionButton.url)) {
    const label = truncateCodepoints(input.actionButton.label || 'Mở liên kết', SLACK_BUTTON_LABEL_MAX_CHARS);
    if (label) {
      tailBlocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: label, emoji: true },
            url: input.actionButton.url.trim(),
          },
        ],
      });
    }
  }

  const maxBodyBlocks = Math.max(1, SLACK_MAX_BLOCKS - topBlocks.length - tailBlocks.length);
  const bodyBlocks: SlackBlock[] = [];
  let clipped = false;

  for (const sec of input.sections) {
    const combined = [sec.heading?.trim(), sec.body.trim()].filter(Boolean).join('\n');
    const chunks = splitMrkdwnChunks(combined, SLACK_SECTION_MAX_CHARS);
    for (const chunk of chunks) {
      if (bodyBlocks.length >= maxBodyBlocks) {
        clipped = true;
        break;
      }
      bodyBlocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: chunk },
      });
    }
    if (clipped) break;
  }

  if (clipped && bodyBlocks.length > 0) {
    const notice = '\n_... (đã lược bớt phần cuối để vừa giới hạn 50 block của Slack)_';
    const lastBlock = bodyBlocks[bodyBlocks.length - 1] as { text: { type: 'mrkdwn'; text: string } };
    const baseText = lastBlock.text.text;
    const room = Math.max(0, SLACK_SECTION_MAX_CHARS - notice.length);
    lastBlock.text.text = `${truncateCodepoints(baseText, room)}${notice}`;
  }

  return [...topBlocks, ...bodyBlocks, ...tailBlocks];
}

function stripSlackMrkdwnFormatting(line: string): string {
  return line
    .replace(/<(https?:\/\/[^|>\s]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:\/\/[^|>\s]+)>/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Wraps an already rendered Slack mrkdwn digest (`headerLine\n...\nfooterLine`) into Block Kit blocks
 * without mutating any verified numbers or text content.
 */
export function buildSlackMarkdownDigestBlocks(input: {
  headerTitle: string;
  messageText: string;
  actionButton?: { label: string; url: string };
}): SlackBlock[] {
  const rawLines = input.messageText.split('\n');
  const firstNonEmptyIdx = rawLines.findIndex((l) => l.trim().length > 0);
  if (firstNonEmptyIdx === -1) {
    return buildSlackDigestBlocks({
      headerTitle: input.headerTitle,
      sections: [{ body: input.headerTitle }],
      actionButton: input.actionButton,
    });
  }

  const firstLine = rawLines[firstNonEmptyIdx]!.trim();
  const restLines = rawLines.slice(firstNonEmptyIdx + 1);

  let footer: string | undefined;
  let lastNonEmptyIdx = restLines.length - 1;
  while (lastNonEmptyIdx >= 0 && !restLines[lastNonEmptyIdx]!.trim()) {
    lastNonEmptyIdx--;
  }
  if (lastNonEmptyIdx >= 0) {
    const candidateFooter = restLines[lastNonEmptyIdx]!.trim();
    if (/^(?:ℹ️|⚠️)\s*_/.test(candidateFooter) || /^_(?:Phạm vi|Tạm thời|Còn mục khác)/.test(candidateFooter)) {
      footer = candidateFooter;
      restLines.splice(lastNonEmptyIdx);
    }
  }

  const subtitle = firstLine.includes('·') ? firstLine : undefined;
  const headerFromLine = stripSlackMrkdwnFormatting(firstLine.split('·')[0] ?? '') || input.headerTitle;

  const sections: SlackDigestBlockSection[] = [];
  let currentGroup: string[] = [];
  for (const line of restLines) {
    if (/^•\s+\*/.test(line.trim()) && currentGroup.length > 0) {
      sections.push({ body: currentGroup.join('\n') });
      currentGroup = [line];
    } else if (line.trim() || currentGroup.length > 0) {
      currentGroup.push(line);
    }
  }
  if (currentGroup.length > 0) {
    sections.push({ body: currentGroup.join('\n') });
  }
  if (sections.length === 0) {
    sections.push({ body: firstLine });
  }

  return buildSlackDigestBlocks({
    headerTitle: headerFromLine,
    subtitle,
    sections,
    footer,
    actionButton: input.actionButton,
  });
}
