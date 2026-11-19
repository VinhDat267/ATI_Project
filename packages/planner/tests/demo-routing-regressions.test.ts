import { describe, expect, it } from 'vitest';
import {
  ALL_TOOLS,
  GMAIL_SERVICE,
  GMAIL_TOOLS,
  MYCALENDAR_SERVICE,
  MYCALENDAR_TOOLS,
  MYSHEETS_SERVICE,
  MYSHEETS_TOOLS,
  SERVICE_REGISTRY,
} from '@wap/tool-schemas';
import { routeIntent } from '../src/router.js';

const services = [...SERVICE_REGISTRY, GMAIL_SERVICE, MYCALENDAR_SERVICE, MYSHEETS_SERVICE];
const personalGoogleTools = [
  ...GMAIL_TOOLS,
  ...MYCALENDAR_TOOLS,
  ...MYSHEETS_TOOLS,
];
const allPersonalAndSlackTools = [
  ...personalGoogleTools,
  ...ALL_TOOLS.filter((t) => ['slack', 'telegram', 'trello'].includes(t.service)),
];

describe('demo routing regressions', () => {
  it('routes OFF-02 prompt with explicit email recipient to mycalendar, mysheets, and gmail', () => {
    const prompt =
      'Tạo lịch họp Google Meet cho dự án Ra mắt sản phẩm quý 4, lưu biên bản vào Google Docs trong thư mục dự án và gửi link cho ati@redlineai.com';
    const result = routeIntent(prompt, personalGoogleTools, services);
    expect(result.unavailable).toEqual([]);
    expect(result.services.slice().sort()).toEqual(['gmail', 'mycalendar', 'mysheets']);
  });

  it('does not falsely route calendar invite or Slack recipient mentions to gmail', () => {
    const calendarOnly = [...MYCALENDAR_TOOLS];
    expect(
      routeIntent('Tạo lịch họp Google Meet lúc 9h ngày mai mời lan@example.com tham dự', calendarOnly, services),
    ).toEqual({ services: ['mycalendar'], unavailable: [] });
    expect(
      routeIntent('Tạo lịch họp Google Meet và gửi lời mời họp cho lan@example.com', calendarOnly, services),
    ).toEqual({ services: ['mycalendar'], unavailable: [] });

    const slackOnly = ALL_TOOLS.filter((t) => t.service === 'slack');
    expect(
      routeIntent('Gửi tin nhắn Slack cho lan@example.com', slackOnly, services),
    ).toEqual({ services: ['slack'], unavailable: [] });
  });

  it('does not pull in Slack when "thông báo" qualifies an email or Telegram notification', () => {
    const googleSuitePrompt =
      'Tạo cuộc họp Google Meet Khởi động Q4 vào 09:00 ngày mai mời khach@acme.vn tham dự, tạo thư mục Q4 trên Google Drive, soạn tài liệu Biên bản trên Google Docs lưu vào thư mục đó, ghi nhật ký vào Google Sheets và gửi email thông báo kèm link Google Meet + Google Docs tới khach@acme.vn qua Gmail.';
    const personalResult = routeIntent(googleSuitePrompt, personalGoogleTools, services);
    expect(personalResult.unavailable).toEqual([]);
    expect(personalResult.services.slice().sort()).toEqual(['gmail', 'mycalendar', 'mysheets']);

    const withSlackResult = routeIntent(googleSuitePrompt, allPersonalAndSlackTools, services);
    expect(withSlackResult.unavailable).toEqual([]);
    expect(withSlackResult.services).not.toContain('slack');
    expect(withSlackResult.services.slice().sort()).toEqual(['gmail', 'mycalendar', 'mysheets']);

    const telegramNotice = routeIntent(
      'Đọc lịch họp hôm nay rồi gửi thông báo qua Telegram của tôi',
      [...MYCALENDAR_TOOLS, ...ALL_TOOLS.filter((t) => t.service === 'telegram')],
      services,
    );
    expect(telegramNotice.unavailable).toEqual([]);
    expect(telegramNotice.services.slice().sort()).toEqual(['mycalendar', 'telegram']);
  });

  it('still routes Slack when a request sends an email and also notifies Slack', () => {
    const mixed = routeIntent(
      'Soạn email báo giá cho khach@acme.vn rồi thông báo vào kênh Slack #ati-test',
      allPersonalAndSlackTools,
      services,
    );
    expect(mixed.unavailable).toEqual([]);
    expect(mixed.services.slice().sort()).toEqual(['gmail', 'slack']);
  });
});
