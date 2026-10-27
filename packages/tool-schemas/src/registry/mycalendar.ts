import type { ServiceDefinition } from '../types.js';
import { MYCALENDAR_SCOPE } from '../mycalendar.js';

export const MYCALENDAR_SERVICE: ServiceDefinition = {
  id: 'mycalendar',
  name: 'Google Calendar của bạn',
  description: 'Xem lịch và tạo sự kiện trong Google Calendar cá nhân của bạn',
  connection: 'personal',
  scopes: [MYCALENDAR_SCOPE],
  scopeKey: 'calendars',
  scopeLabel: 'Lịch Google Calendar của bạn',
  credentialFields: [],
  intentKeywords: [
    'lịch của tôi',
    'lịch của mình',
    'lịch cá nhân',
    'lịch riêng',
    'my calendar',
    'calendar của tôi',
    'lịch google của tôi',
  ],
};
