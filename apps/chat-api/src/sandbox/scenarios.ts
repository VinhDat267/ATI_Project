import { MockLLMProvider } from '@wap/planner';

export function createSandboxProvider(scenario?: string) {
  const mockProvider = new MockLLMProvider();
    const sandboxPlan = {
        kind: 'plan',
        thinking: 'Khảo sát board Frontend trên Trello và kênh Slack #general. Lập kế hoạch tạo task sửa CSS, gán thành viên Minh và thông báo hoàn tất lên Slack.',
        summary: 'Tạo thẻ Trello sửa CSS, gán Minh và thông báo kênh Slack #general',
        steps: [
          {
            id: 'step_1',
            tool: 'trello.create_card',
            description: 'Tạo thẻ "Sửa lỗi responsive CSS" trên list To Do',
            args: { listId: 'list_frontend_todo', title: 'Sửa lỗi responsive CSS' },
            dependsOn: [],
          },
          {
            id: 'step_2',
            tool: 'trello.add_member',
            description: 'Gán thành viên Minh vào thẻ vừa tạo',
            args: { cardId: { $ref: 'step_1.output.id' }, memberId: 'member_minh_dev' },
            dependsOn: ['step_1'],
          },
          {
            id: 'step_3',
            tool: 'slack.send_message',
            description: 'Gửi tin nhắn thông báo lên kênh Slack #general',
            args: { channel: '#general', text: { $template: 'Đã tạo task mới cho Minh: ${step_1.output.url}' } },
            dependsOn: ['step_1'],
          },
        ],
        warnings: [],
      };
    const threeServicePlan = {
      kind: 'plan',
      thinking: 'Tạo issue GitHub, chuyển liên kết vào thẻ Trello, rồi thông báo cả hai liên kết qua Slack.',
      summary: 'Tạo issue GitHub, thẻ Trello liên kết và thông báo Slack',
      steps: [
        {
          id: 'step_1', tool: 'github.create_issue',
          description: 'Tạo issue trong repository được cấp quyền',
          args: { repo: 'owner/repo', title: 'Sửa lỗi responsive CSS' }, dependsOn: [],
        },
        {
          id: 'step_2', tool: 'trello.create_card',
          description: 'Tạo thẻ Trello dẫn tới GitHub issue',
          args: { listId: 'list_frontend_todo', title: 'Sửa lỗi responsive CSS', desc: { $template: 'Theo dõi GitHub issue: ${step_1.output.url}' } },
          dependsOn: ['step_1'],
        },
        {
          id: 'step_3', tool: 'slack.send_message',
          description: 'Thông báo issue GitHub và thẻ Trello',
          args: { channel: '#general', text: { $template: 'Issue: ${step_1.output.url}; Trello: ${step_2.output.url}' } },
          dependsOn: ['step_1', 'step_2'],
        },
      ],
      warnings: [],
    };
  const sheetsPlan = {
    kind: 'plan', thinking: 'Đọc bảng tính thử nghiệm, thêm dòng và báo vùng cập nhật qua Slack.',
    summary: 'Đọc và thêm dòng Google Sheets, thông báo Slack', warnings: [],
    steps: [
      { id: 'step_1', tool: 'sheets.read_range', description: 'Đọc tab Tasks', args: { spreadsheetId: 'spreadsheet_fixture_123456', range: 'Tasks!A1:B3', limit: 3 }, dependsOn: [] },
      { id: 'step_2', tool: 'sheets.append_rows', description: 'Thêm dòng vào tab Tasks', args: { spreadsheetId: 'spreadsheet_fixture_123456', sheet: 'Tasks', rows: [['Sandbox task']] }, dependsOn: ['step_1'] },
      { id: 'step_3', tool: 'slack.send_message', description: 'Thông báo vùng đã cập nhật', args: { channel: '#general', text: { $template: 'Đã thêm dòng vào Google Sheets: ${step_2.output.updatedRange}' } }, dependsOn: ['step_2'] },
    ],
  };
  const calendarPlan = {
    kind: 'plan', thinking: 'Tạo sự kiện trong lịch thử nghiệm đã tìm thấy, rồi gửi liên kết và giờ bắt đầu qua Slack.',
    summary: 'Tạo lịch họp Google Calendar và thông báo Slack', warnings: [],
    steps: [
      { id: 'step_1', tool: 'calendar.create_event', description: 'Tạo sự kiện review', args: { calendarId: 'ati@group.calendar.google.com', summary: 'ATI Review', start: '2026-10-09T15:00:00+07:00', end: '2026-10-09T16:00:00+07:00' }, dependsOn: [] },
      { id: 'step_2', tool: 'slack.send_message', description: 'Thông báo liên kết và giờ bắt đầu', args: { channel: '#general', text: { $template: 'Lịch họp: ${step_1.output.url}; bắt đầu: ${step_1.output.start}' } }, dependsOn: ['step_1'] },
    ],
  };
  const notionPlan = {
    kind: 'plan', thinking: 'Tạo page trong database Notion đã tìm thấy, rồi chuyển URL vào thông báo Slack.',
    summary: 'Tạo biên bản Notion và thông báo Slack', warnings: [],
    steps: [
      { id: 'step_1', tool: 'notion.create_page', description: 'Tạo biên bản ATI', args: { databaseId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'ATI Review', content: 'Biên bản thử nghiệm sandbox' }, dependsOn: [] },
      { id: 'step_2', tool: 'slack.send_message', description: 'Thông báo liên kết biên bản', args: { channel: '#general', text: { $template: 'Biên bản: ${step_1.output.url}' } }, dependsOn: ['step_1'] },
    ],
  };
  const telegramPlan = {
    kind: 'plan', thinking: 'Gửi văn bản vào chat Telegram đã tìm thấy, rồi chuyển messageId qua Slack.',
    summary: 'Gửi Telegram và thông báo mã tin nhắn qua Slack', warnings: [],
    steps: [
      { id: 'step_1', tool: 'telegram.send_message', description: 'Gửi văn bản thuần', args: { chatId: '-1001234567890', text: 'ATI Test sandbox' }, dependsOn: [] },
      { id: 'step_2', tool: 'slack.send_message', description: 'Thông báo mã tin nhắn', args: { channel: '#general', text: { $template: 'Telegram message: ${step_1.output.messageId}' } }, dependsOn: ['step_1'] },
    ],
  };
  mockProvider.setPlanResponses([scenario === 'telegram_slack' ? telegramPlan : scenario === 'notion_slack' ? notionPlan : scenario === 'calendar_slack' ? calendarPlan : scenario === 'sheets_slack' ? sheetsPlan : scenario === 'three_service' ? threeServicePlan : sandboxPlan]);
  return mockProvider;
}

export function createBackupSandboxProvider() {
  const backupMockProvider = new MockLLMProvider();
  backupMockProvider.setPlanResponses([
    {
      kind: 'plan',
      thinking: 'Hệ thống phân tích yêu cầu tạo task trên Trello và gửi thông báo qua Slack channel.',
      summary: 'Tạo thẻ Trello sửa CSS, gán Minh và thông báo Slack #general',
      steps: [
        {
          id: 'step_1',
          tool: 'trello.create_card',
          description: 'Tạo thẻ trên board Frontend',
          args: { listId: 'list_todo', title: 'Sửa lỗi CSS responsive' },
          dependsOn: [],
        },
        {
          id: 'step_2',
          tool: 'trello.add_member',
          description: 'Gán người phụ trách Minh Dev',
          args: { cardId: { $ref: 'step_1.output.id' }, memberId: 'member_minh' },
          dependsOn: ['step_1'],
        },
        {
          id: 'step_3',
          tool: 'slack.send_message',
          description: 'Gửi thông báo kênh Slack #general',
          args: { channel: '#general', text: { $template: 'Đã tạo thẻ mới: ${step_1.output.url}' } },
          dependsOn: ['step_1'],
        },
      ],
      warnings: [],
    },
  ]);
  return backupMockProvider;
}
