import type { ToolDefinition } from './types.js';

// Explicit ids (including email/holiday ids); the user-relative alias primary is not a resource scope.
export const CALENDAR_ID_PATTERN = /^(?!primary$)(?!\.{1,2}$)[A-Za-z0-9_.+#-]{1,254}(?:@[A-Za-z0-9.-]{1,253})?$/;
export const CALENDAR_TIME_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$';
const str = { type: 'string' };
const time = { type: 'string', pattern: CALENDAR_TIME_PATTERN };
const calendarId = { type: 'string', pattern: CALENDAR_ID_PATTERN.source, 'x-resource': 'calendar' };
const input = (properties: object, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const output = (properties: object, required: string[]) => ({ type: 'object', properties, required });
const event = output({ id: str, title: str, start: str, end: str, url: str }, ['id', 'title', 'start', 'end', 'url']);

export const CALENDAR_TOOLS: ToolDefinition[] = [
  { name: 'calendar.list_calendars', service: 'calendar', sideEffect: 'read', riskLevel: 'low', discovers: 'calendar', listable: true,
    description: 'Liệt kê các lịch trong allowlist và lọc theo tên; query rỗng để lấy danh sách.',
    inputSchema: input({ query: str, limit: { type: 'integer', minimum: 1, maximum: 10, default: 10 } }, ['query']),
    outputSchema: { type: 'array', items: output({ id: str, title: str, timeZone: str }, ['id', 'title', 'timeZone']) } },
  { name: 'calendar.list_events', service: 'calendar', sideEffect: 'read', riskLevel: 'low',
    description: 'Xem tối đa 20 sự kiện theo giờ bắt đầu trong một lịch đã tìm thấy, khoảng tối đa 31 ngày; thời gian ISO có múi giờ. Tiêu đề tối đa 200 ký tự, dài hơn thì bị cắt và kết quả có truncated: true.',
    inputSchema: input({ calendarId, timeMin: time, timeMax: time, query: str, limit: { type: 'integer', minimum: 1, maximum: 20, default: 20 } }, ['calendarId', 'timeMin', 'timeMax']),
    outputSchema: output({ events: { type: 'array', items: event }, truncated: { type: 'boolean' } }, ['events']) },
  { name: 'calendar.create_event', service: 'calendar', sideEffect: 'write', riskLevel: 'medium',
    description: 'Sau khi duyệt, tạo sự kiện tối đa 24 giờ trong lịch đã tìm thấy; ISO có múi giờ, không mời người khác hay gửi thông báo.',
    inputSchema: input({ calendarId, summary: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: 'string', maxLength: 4000 },
      start: time, end: time, location: { type: 'string', maxLength: 1000 } }, ['calendarId', 'summary', 'start', 'end']), outputSchema: event },
];
