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

  it('automatically routes generic Google Sheets / bảng tính prompts to mysheets when user connected mysheets without shared sheets', () => {
    const personalOnlyTools = [
      ...ALL_TOOLS.filter((t) => t.service !== 'sheets'),
      ...MYSHEETS_TOOLS,
    ];
    expect(
      routeIntent('Ghi một dòng vào Google Sheets KPI Tháng 11', personalOnlyTools, combinedServices)
    ).toEqual({
      services: ['mysheets'],
      unavailable: [],
    });

    expect(
      routeIntent('Lấy các thẻ trên Trello ghi vào bảng tính Báo cáo tuần', personalOnlyTools, combinedServices)
    ).toEqual({
      services: ['trello', 'mysheets'],
      unavailable: [],
    });

    // Even when both shared sheets and mysheets are in the catalog (e.g. sandbox mode), natural prompts without "của tôi" prefer mysheets unless "bảng tính chung/nhóm" is requested
    expect(
      routeIntent('Cập nhật trạng thái trong bảng tính CRM Khách hàng', combinedTools, combinedServices)
    ).toEqual({
      services: ['mysheets'],
      unavailable: [],
    });
  });

  it('still refuses with unavailable shared sheets when user explicitly asks for shared spreadsheet but only has mysheets', () => {
    const personalOnlyTools = [
      ...ALL_TOOLS.filter((t) => t.service !== 'sheets'),
      ...MYSHEETS_TOOLS,
    ];
    const result = routeIntent('Ghi một dòng vào bảng tính chung của nhóm', personalOnlyTools, combinedServices);
    expect(result.services).toEqual([]);
    expect(result.unavailable).toEqual([{ id: 'sheets', name: 'Google Sheets' }]);
  });

  it('routes Google Docs and Google Drive prompts (biên bản họp, thư mục Drive, Google Docs) to mysheets', () => {
    const personalOnlyTools = [
      ...ALL_TOOLS.filter((t) => t.service !== 'sheets'),
      ...MYSHEETS_TOOLS,
    ];
    expect(
      routeIntent('Tạo một thư mục trên Google Drive và soạn biên bản họp trong Google Docs', personalOnlyTools, combinedServices)
    ).toEqual({
      services: ['mysheets'],
      unavailable: [],
    });
  });
});
