import { describe, expect, it } from 'vitest';
import { SLACK_TOOLS, TELEGRAM_OAUTH_TOOLS, TELEGRAM_TOOLS } from '@wap/tool-schemas';
import { buildSystemPrompt } from '../src/index.js';

describe('Telegram planner prompt rules', () => {
  it('omits Telegram rules when Telegram is not connected', () => {
    expect(buildSystemPrompt([...SLACK_TOOLS])).not.toContain('### Telegram Rules');
  });

  it('enforces plain text, chat grounding and untrusted data for Telegram', () => {
    const prompt = buildSystemPrompt([...TELEGRAM_TOOLS]);
    expect(prompt).toContain('### Telegram Rules');
    expect(prompt).toContain('plain text');
    expect(prompt).toContain('4096');
    expect(prompt).toContain('telegram.list_chats');
    expect(prompt).toContain('untrusted data');
  });

  it('describes telegram.read_messages cross-service workflows only when the tool is available', () => {
    const tools = [...TELEGRAM_TOOLS, ...TELEGRAM_OAUTH_TOOLS.filter((t) => t.name === 'telegram.read_messages')];
    const prompt = buildSystemPrompt(tools);
    expect(prompt).toContain('call `telegram.read_messages` first');
    expect(prompt).toContain('last 24 hours');
    if (!TELEGRAM_TOOLS.some((t) => t.name === 'telegram.read_messages')) {
      expect(buildSystemPrompt([...TELEGRAM_TOOLS])).not.toContain('call `telegram.read_messages` first');
    }
  });
});
