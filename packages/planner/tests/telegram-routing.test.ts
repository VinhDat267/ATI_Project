import { expect, it } from 'vitest';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { classifyIntent } from '../src/router.js';

it.each([
  ['Gửi tin nhắn lên kênh ati-test', ['slack']],
  ['Báo nhóm Telegram ATI Test là đã hoàn tất', ['telegram']],
  ['Báo nhóm Telegram ATI Test là đã tạo issue', ['telegram']],
  ['Tạo issue GitHub rồi báo Telegram', ['github', 'telegram']],
  ['Gửi thông báo lên cả Slack và Telegram', ['slack', 'telegram']],
  ['Tạo issue rồi báo Telegram', ['github', 'telegram']],
  ['Báo Telegram là đã tạo issue rồi tạo issue mới', ['github', 'telegram']],
  ['Báo Telegram là đã tạo issue; tạo issue mới trên GitHub', ['github', 'telegram']],
  ['Báo Telegram là đã tạo issue\nTạo issue trên GitHub', ['github', 'telegram']],
  ['Báo Telegram và Slack là đã tạo issue', ['slack', 'telegram']],
  ['Báo Telegram rằng đã tạo issue và card', ['telegram']],
])('routes %s against the entire registry', (prompt, expected) => expect(classifyIntent(prompt, ALL_TOOLS)).toEqual(expected));

it('keeps implicit message requests on Slack while refusing explicit unavailable Telegram', () => {
  const catalog = ALL_TOOLS.filter(t => t.service !== 'telegram');
  expect(classifyIntent('Gửi tin nhắn lên kênh ati-test', catalog)).toEqual(['slack']);
  expect(classifyIntent('Báo nhóm Telegram ATI Test', catalog)).toEqual([]);
});

it('allows a completed-issue notification with only Telegram connected, preserving actual unavailable requests', () => {
  const catalog = ALL_TOOLS.filter(t => t.service === 'telegram');
  expect(classifyIntent('Báo nhóm Telegram ATI Test là đã tạo issue', catalog)).toEqual(['telegram']);
  expect(classifyIntent('Báo Telegram rằng đã tạo issue GitHub', catalog)).toEqual(['telegram']);
  expect(classifyIntent('Tạo issue GitHub rồi báo Telegram', catalog)).toEqual([]);
  expect(classifyIntent('Báo Telegram là đã tạo issue rồi tạo issue mới trên GitHub', catalog)).toEqual([]);
  expect(classifyIntent('Báo Telegram là đã tạo issue\nTạo issue GitHub', catalog)).toEqual([]);
});
