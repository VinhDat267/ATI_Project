import type { ToolDefinition } from './types.js';
import { CALENDAR_ID_PATTERN, CALENDAR_TIME_PATTERN } from './calendar.js';

export const MYCALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';

const str = { type: 'string' };
const time = { type: 'string', pattern: CALENDAR_TIME_PATTERN };
const calendarId = { type: 'string', pattern: CALENDAR_ID_PATTERN.source, 'x-resource': 'mycalendar' };
const input = (properties: object, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const output = (properties: object, required: string[]) => ({ type: 'object', properties, required });
const event = output(
  {
    id: str,
    title: str,
    start: str,
    end: str,
    url: str,
    location: str,
    meetLink: str,
    attendeesCount: { type: 'integer', minimum: 0 },
    recurrence: str,
  },
  ['id', 'title', 'start', 'end', 'url'],
);

const eventObservedFields = [
  'id',
  'title',
  'start',
  'end',
  'url',
  'location',
  'meetLink',
  'attendeesCount',
  'recurrence',
  'calendarId',
];

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
    discovers: 'myevent',
    observedFields: eventObservedFields,
    description: 'Xem tối đa 20 sự kiện theo giờ bắt đầu trong một lịch cá nhân đã tìm thấy, khoảng tối đa 31 ngày; thời gian ISO có múi giờ hoặc dùng query tự nhiên ("hôm nay", "ngày mai", "tuần này"). Tiêu đề tối đa 200 ký tự, dài hơn thì bị cắt và kết quả có truncated: true.',
    inputSchema: input({ calendarId, timeMin: time, timeMax: time, query: str, limit: { type: 'integer', minimum: 1, maximum: 20, default: 20 } }, ['calendarId']),
    outputSchema: output({ events: { type: 'array', items: event }, truncated: { type: 'boolean' } }, ['events']),
  },
  {
    name: 'mycalendar.get_event',
    service: 'mycalendar',
    sideEffect: 'read',
    riskLevel: 'low',
    discovers: 'myevent',
    observedFields: [...eventObservedFields, 'description'],
    description: 'Đọc chi tiết một sự kiện cụ thể trong lịch cá nhân theo eventId, bao gồm toàn bộ nội dung mô tả (description / agenda cuộc họp), link Google Meet, địa điểm và quy tắc lặp lại.',
    inputSchema: input(
      {
        calendarId,
        eventId: { type: 'string', minLength: 1, maxLength: 256 },
      },
      ['calendarId', 'eventId'],
    ),
    outputSchema: output(
      {
        id: str,
        title: str,
        description: str,
        start: str,
        end: str,
        url: str,
        location: str,
        meetLink: str,
        attendeesCount: { type: 'integer', minimum: 0 },
        recurrence: str,
      },
      ['id', 'title', 'start', 'end', 'url'],
    ),
  },
  {
    name: 'mycalendar.find_free_slots',
    service: 'mycalendar',
    sideEffect: 'read',
    riskLevel: 'low',
    description: 'Tìm các khung giờ trống (freeSlots) không bị trùng lịch trong giờ làm việc (mặc định 08:00–18:00) theo thời lượng cuộc họp mong muốn (durationMinutes, mặc định 60 phút). Hỗ trợ timeMin/timeMax hoặc query tự nhiên ("hôm nay", "ngày mai", "tuần này").',
    inputSchema: input(
      {
        calendarId,
        timeMin: time,
        timeMax: time,
        query: str,
        durationMinutes: { type: 'integer', minimum: 15, maximum: 480, default: 60 },
        workdayStartHour: { type: 'integer', minimum: 0, maximum: 23, default: 8 },
        workdayEndHour: { type: 'integer', minimum: 1, maximum: 24, default: 18 },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      },
      ['calendarId'],
    ),
    outputSchema: output(
      {
        calendarId: str,
        busyCount: { type: 'integer', minimum: 0 },
        freeSlots: {
          type: 'array',
          items: output(
            {
              start: str,
              end: str,
              durationMinutes: { type: 'integer', minimum: 15 },
              label: str,
            },
            ['start', 'end', 'durationMinutes', 'label'],
          ),
        },
      },
      ['calendarId', 'busyCount', 'freeSlots'],
    ),
  },
  {
    name: 'mycalendar.create_event',
    service: 'mycalendar',
    sideEffect: 'write',
    riskLevel: 'medium',
    description: 'Sau khi duyệt, tạo sự kiện tối đa 24 giờ trong lịch cá nhân đã tìm thấy; ISO có múi giờ, hỗ trợ tạo phòng họp Google Meet (createMeetLink: true) và lặp lại định kỳ (recurrence: "DAILY" | "WEEKDAYS" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "RRULE:..."), không mời người khác hay gửi thông báo.',
    inputSchema: input(
      {
        calendarId,
        summary: { type: 'string', minLength: 1, maxLength: 200 },
        description: { type: 'string', maxLength: 4000 },
        start: time,
        end: time,
        location: { type: 'string', maxLength: 1000 },
        createMeetLink: { type: 'boolean' },
        recurrence: { type: 'string', maxLength: 500 },
      },
      ['calendarId', 'summary', 'start', 'end'],
    ),
    outputSchema: event,
  },
  {
    name: 'mycalendar.update_event',
    service: 'mycalendar',
    sideEffect: 'write',
    riskLevel: 'medium',
    description: 'Sau khi duyệt, cập nhật hoặc dời giờ một sự kiện đã có trong lịch cá nhân theo eventId; hỗ trợ bật Google Meet (createMeetLink: true) và cập nhật quy tắc lặp lại (recurrence).',
    inputSchema: input(
      {
        calendarId,
        eventId: { type: 'string', minLength: 1, maxLength: 256 },
        summary: { type: 'string', minLength: 1, maxLength: 200 },
        description: { type: 'string', maxLength: 4000 },
        start: time,
        end: time,
        location: { type: 'string', maxLength: 1000 },
        createMeetLink: { type: 'boolean' },
        recurrence: { type: 'string', maxLength: 500 },
      },
      ['calendarId', 'eventId'],
    ),
    outputSchema: event,
  },
  {
    name: 'mycalendar.delete_event',
    service: 'mycalendar',
    sideEffect: 'write',
    riskLevel: 'high',
    description: 'Sau khi duyệt, xoá hoặc huỷ một sự kiện trong lịch cá nhân theo eventId.',
    inputSchema: input(
      {
        calendarId,
        eventId: { type: 'string', minLength: 1, maxLength: 256 },
      },
      ['calendarId', 'eventId'],
    ),
    outputSchema: output({ id: str, deleted: { type: 'boolean' } }, ['id', 'deleted']),
  },
];
