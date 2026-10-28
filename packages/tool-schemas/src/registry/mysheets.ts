import type { ServiceDefinition } from '../types.js';
import { MYSHEETS_SCOPE } from '../mysheets.js';

export const MYSHEETS_SERVICE: ServiceDefinition = {
  id: 'mysheets',
  name: 'Google Sheets của bạn',
  description: 'Đọc và thêm dòng vào các bảng tính Google Sheets cá nhân mà bạn đã chọn cho ATI',
  connection: 'personal',
  scopes: [MYSHEETS_SCOPE],
  scopeKey: 'spreadsheets',
  scopeLabel: 'Bảng tính Google Sheets của bạn',
  credentialFields: [],
  intentKeywords: [
    'bảng tính của tôi',
    'bảng tính của mình',
    'bảng tính cá nhân',
    'bảng tính riêng',
    'sheet của tôi',
    'sheets của tôi',
    'google sheets của tôi',
    'my spreadsheet',
    'my sheet',
    'my google sheet',
    'spreadsheet của tôi',
  ],
};
