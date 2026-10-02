import { expect, it } from 'vitest';
import { ALL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import { classifyIntent } from '../src/router.js';

it.each([
  ['Tạo card trên bảng Frontend rồi báo Slack', ['trello', 'slack']],
  ['Ghi một dòng vào bảng tính ATI Test Tracker', ['sheets']],
  ['Thêm dòng checklist vào card', ['trello']],
  ['Read Google Sheets then báo Slack', ['slack', 'sheets']],
])('routes safely with all services: %s', (prompt, services) => {
  expect(classifyIntent(prompt, ALL_TOOLS, SERVICE_REGISTRY)).toEqual(services);
  const unavailable = ALL_TOOLS.filter(tool => tool.service !== 'sheets');
  expect(classifyIntent(prompt, unavailable, SERVICE_REGISTRY)).toEqual(services.includes('sheets') ? [] : services);
});
