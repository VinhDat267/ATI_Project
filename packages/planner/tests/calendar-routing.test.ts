import { expect, it } from 'vitest';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { classifyIntent } from '../src/router.js';

it.each([
  ['Đặt lịch họp review lúc 15h thứ Sáu và báo kênh ati-test', ['slack', 'calendar']],
  ['Schedule a Google Calendar meeting with the frontend team tomorrow at 3pm', ['calendar']],
  ['Xem lịch sử commit của repo ati-test', ['github']],
  ['Tạo event trong calendar', ['calendar']],
])('routes %s with every registered service', (prompt, services) => expect(classifyIntent(prompt, ALL_TOOLS)).toEqual(services));
it('preserves Slack meeting content when Calendar is not configured and refuses explicit unavailable Calendar', () => {
  const without = ALL_TOOLS.filter(t => t.service !== 'calendar');
  expect(classifyIntent('Báo lên Slack là cuộc họp dời sang 3 giờ', without)).toEqual(['slack']);
  expect(classifyIntent('Schedule a Google Calendar meeting with the frontend team tomorrow at 3pm', without)).toEqual([]);
});
