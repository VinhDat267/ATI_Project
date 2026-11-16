import { describe, expect, it } from 'vitest';
import { slackMrkdwnToTelegramPlain } from '../../../src/services/schedules/telegram-plain-text.js';

describe('slackMrkdwnToTelegramPlain', () => {
  it('turns Slack links, emphasis, quotes and entities into readable Telegram text', () => {
    const slack = [
      '*Bản tin Trello tự động của Planora* · thiết lập bởi @an',
      '> 💡 *Nhận xét AI:* Có 2 thẻ quá hạn',
      '• *🚨 Thẻ quá hạn (2):*',
      '  - [Sprint &amp; QA] <https://trello.com/c/abc|Sửa lỗi &lt;login&gt;> _(hạn: 16/11/2026 09:00 (Asia/Ho_Chi_Minh))_',
      '  - _(Không có thẻ nào trong mẫu quét)_',
      'Link trần <https://example.test/x>',
    ].join('\n');

    expect(slackMrkdwnToTelegramPlain(slack)).toBe(
      [
        'Bản tin Trello tự động của Planora · thiết lập bởi @an',
        '💡 Nhận xét AI: Có 2 thẻ quá hạn',
        '• 🚨 Thẻ quá hạn (2):',
        '  - [Sprint & QA] Sửa lỗi <login> — https://trello.com/c/abc (hạn: 16/11/2026 09:00 (Asia/Ho_Chi_Minh))',
        '  - (Không có thẻ nào trong mẫu quét)',
        'Link trần https://example.test/x',
      ].join('\n'),
    );
  });

  it('keeps identifiers with inner underscores or asterisks intact', () => {
    expect(slackMrkdwnToTelegramPlain('Asia/Ho_Chi_Minh và a*b*c')).toBe('Asia/Ho_Chi_Minh và a*b*c');
  });
});
