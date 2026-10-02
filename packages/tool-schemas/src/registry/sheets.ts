import type { ServiceDefinition } from '../types.js';

export const SHEETS_SERVICE: ServiceDefinition = {
  id: 'sheets', name: 'Google Sheets', description: 'Đọc và thêm dòng vào bảng tính được cấp quyền',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  scopeKey: 'spreadsheets', scopeLabel: 'Spreadsheet ID', scopePattern: /^[A-Za-z0-9_-]{20,}$/,
  credentialFields: [
    { key: 'clientEmail', label: 'Email service account', type: 'text' },
    { key: 'privateKey', label: 'Private key (PEM)', type: 'multiline' },
  ],
  intentKeywords: ['sheets', 'google sheets', 'spreadsheet', 'bảng tính', 'trang tính', 'sheet'],
};
