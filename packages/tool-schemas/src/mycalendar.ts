import type { ToolDefinition } from './types.js';
import { CALENDAR_ID_PATTERN, CALENDAR_TIME_PATTERN } from './calendar.js';

export const MYCALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';

const str = { type: 'string' };
const time = { type: 'string', pattern: CALENDAR_TIME_PATTERN };
const calendarId = { type: 'string', pattern: CALENDAR_ID_PATTERN.source, 'x-resource': 'mycalendar' };
const input = (properties: object, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const output = (properties: object, required: string[]) => ({ type: 'object', properties, required });
const event = output({ id: str, title: str, start: str, end: str, url: str }, ['id', 'title', 'start', 'end', 'url']);

export const MYCALENDAR_TOOLS: ToolDefinition[] = [
  {
    name: 'mycalendar.list_calendars',
    service: 'mycalendar',
    sideEffect: 'read',
    riskLevel: 'low',
    discovers: 'mycalendar',
    listable: true,
    description: 'Liệt kê các lịch của người dùng và lọc theo tên; query rỗng để lấy danh sách.',
    inputSchema: input({ query: str, limit: { type: 'integer', minimum: 1, maximum: 10, default: 10 } }, ['query']),
    outputSchema: { type: 'array', items: output({ id: str, title: str, timeZone: str }, ['id', 'title', 'timeZone']) },
  },
  {
    name: 'mycalendar.list_events',
    service: 'mycalendar',
    sideEffect: 'read',
    riskLevel: 'low',
    description: 'Xem tối đa 20 sự kiện theo giờ bắt đầu trong một lịch cá nhân đã tìm thấy, khoảng tối đa 31 ngày; thời gian ISO có múi giờ. Tiêu đề tối đa 200 ký tự, dài hơn thì bị cắt và kết quả có truncated: true.',
    inputSchema: input({ calendarId, timeMin: time, timeMax: time, query: str, limit: { type: 'integer', minimum: 1, maximum: 20, default: 20 } }, ['calendarId', 'timeMin', 'timeMax']),
    outputSchema: output({ events: { type: 'array', items: event }, truncated: { type: 'boolean' } }, ['events']),
  },
  {
    name: 'mycalendar.create_event',
    service: 'mycalendar',
    sideEffect: 'write',
    riskLevel: 'medium',
    description: 'Sau khi duyệt, tạo sự kiện tối đa 24 giờ trong lịch cá nhân đã tìm thấy; ISO có múi giờ, không mời người khác hay gửi thông báo.',
    inputSchema: input({ calendarId, summary: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: 'string', maxLength: 4000 },
      start: time, end: time, location: { type: 'string', maxLength: 1000 } }, ['calendarId', 'summary', 'start', 'end']),
    outputSchema: event,
  },
];
