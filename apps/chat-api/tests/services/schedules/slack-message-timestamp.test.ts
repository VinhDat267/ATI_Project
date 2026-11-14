import { describe, expect, it } from 'vitest';
import { isSlackMessageTimestamp } from '../../../src/services/schedules/slack-message-timestamp.js';

describe('Slack digest receipt timestamp', () => {
  it.each([undefined, null, 'abc', 'undefined', 'null', '', '1234.abc', '1234.123'])('rejects %s', value => {
    expect(isSlackMessageTimestamp(value)).toBe(false);
  });

  it('accepts a provider timestamp with six fractional digits', () => {
    expect(isSlackMessageTimestamp('1730000111.000200')).toBe(true);
  });
});
