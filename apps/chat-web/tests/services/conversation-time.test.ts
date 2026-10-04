import { expect, it } from 'vitest';
import { formatConversationTime } from '../../src/services/conversation-time';
it('formats sidebar hours as Vietnamese 24-hour time regardless of browser default locale', () => {
  const date = new Date(); date.setHours(18, 24, 0, 0);
  expect(formatConversationTime(date.toISOString())).toBe('18:24');
});
