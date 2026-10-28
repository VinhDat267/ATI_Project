import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, SERVICE_REGISTRY, MYSHEETS_SERVICE, MYSHEETS_TOOLS } from '@wap/tool-schemas';
import { classifyIntent, routeIntent } from '../src/router.js';

const combinedServices = [...SERVICE_REGISTRY, MYSHEETS_SERVICE];
const combinedTools = [...ALL_TOOLS, ...MYSHEETS_TOOLS];

describe('mysheets router rules', () => {
  it('prefers mysheets when both match and user does not mention shared spreadsheet keywords', () => {
    const prompt = 'Ghi một dòng vào bảng tính của tôi';
    const result = routeIntent(prompt, combinedTools, combinedServices);
    expect(result.services).toEqual(['mysheets']);
  });

  it('keeps sheets when shared spreadsheet keywords are mentioned', () => {
    const prompt = 'Ghi một dòng vào bảng tính chung của nhóm';
    const result = routeIntent(prompt, combinedTools, combinedServices);
    expect(result.services).toEqual(['sheets']);
  });

  it('returns unavailable refusal for mysheets when not in catalog', () => {
    const prompt = 'Ghi một dòng vào bảng tính của tôi';
    // ALL_TOOLS does not have MYSHEETS_TOOLS
    const result = routeIntent(prompt, ALL_TOOLS, combinedServices);
    expect(result.services).toEqual([]);
    expect(result.unavailable).toEqual([{ id: 'mysheets', name: 'Google Sheets của bạn' }]);
  });
});
