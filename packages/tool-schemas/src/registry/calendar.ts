import type { ServiceDefinition } from '../types.js';
import { CALENDAR_ID_PATTERN } from '../calendar.js';

export const CALENDAR_SERVICE: ServiceDefinition = {
  id: 'calendar', name: 'Google Calendar', description: 'Xem lịch và tạo sự kiện trong lịch được cấp quyền',
  scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'],
  scopeKey: 'calendars', scopeLabel: 'Calendar ID', scopePattern: CALENDAR_ID_PATTERN,
  credentialFields: [{ key: 'clientEmail', label: 'Email service account', type: 'text' }, { key: 'privateKey', label: 'Private key (PEM)', type: 'multiline' }],
  intentKeywords: ['calendar', 'google calendar', 'lịch họp', 'lên lịch', 'đặt lịch'],
  fallbackIntentKeywords: ['cuộc họp', 'họp', 'meeting', 'sự kiện', 'event'],
};
