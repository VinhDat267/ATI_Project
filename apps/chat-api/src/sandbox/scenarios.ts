import { MockLLMProvider } from '@wap/planner';

export function createSandboxProvider(scenario?: string) {
  const mockProvider = new MockLLMProvider();
  if(scenario==='slack_read'){
    mockProvider.generatePlan=async input=>{
      const content=input.conversationHistory.at(-1)?.content??'';
      const history=content.includes('C_FIXTURE');
      return JSON.stringify({kind:'plan',thinking:'Read only after approval',summary:history?'Đọc tin Slack bạn chọn':'Liệt kê kênh Slack',warnings:[],
        steps:[{id:'step_1',tool:history?'myslack.conversations_history':'myslack.conversations_list',description:history?'Đọc10tin ở kênh C_FIXTURE':'Liệt kê kênh',args:history?{channel:'C_FIXTURE',limit:10}:{limit:10},dependsOn:[]}]});
    };
    return mockProvider;
  }
  if (scenario === 'gmail') {
    const responses = [
      { kind: 'search', calls: [{ tool: 'gmail.search_threads', args: { query: 'Họp nhóm ATI', limit: 10 } }] },
      { kind: 'plan', thinking: 'Trả lời luồng thư đã tìm thấy.', summary: 'Trả lời thư họp nhóm ATI', warnings: [],
        steps: [{ id: 'gmail_reply', tool: 'gmail.reply', description: 'Trả lời Lan về buổi họp', args: { threadId: 'gmail-thread-1', to: ['lan@example.com'], body: 'Mình đồng ý, hẹn gặp lúc 9 giờ.' }, dependsOn: [] }] },
    ];
    mockProvider.setPlanResponses(responses);
    const fallback = mockProvider.generatePlan.bind(mockProvider);
    // Each browser conversation starts with a search; another user's request
    // must not consume a global sequence of canned responses.
    mockProvider.generatePlan = async input => Array.isArray(input.conversationHistory)
      ? JSON.stringify(responses[input.conversationHistory.at(-1)?.content.includes('<search_results>') ? 1 : 0])
      : fallback(input);
    return mockProvider;
  }
  if (scenario === 'mycalendar') {
    const responses = [
      { kind: 'search', calls: [{ tool: 'mycalendar.list_calendars', args: { query: '' } }] },
      {
        kind: 'plan',
        thinking: 'Tạo sự kiện trong lịch cá nhân.',
        summary: 'Tạo sự kiện lịch cá nhân',
        warnings: [],
        steps: [
          {
            id: 'create_event',
            tool: 'mycalendar.create_event',
            description: 'Tạo sự kiện họp',
            args: {
              calendarId: 'user@example.com',
              summary: 'Họp việc riêng',
              start: '2026-10-28T09:00:00+07:00',
              end: '2026-10-28T10:00:00+07:00',
            },
            dependsOn: [],
          },
        ],
      },
    ];
    mockProvider.setPlanResponses(responses);
    const fallback = mockProvider.generatePlan.bind(mockProvider);
    mockProvider.generatePlan = async (input) => {
      if (!Array.isArray(input.conversationHistory)) return fallback(input);
      const last = input.conversationHistory.at(-1)?.content ?? '';
      const allUserText = [
        (input as any).userMessage ?? '',
        ...input.conversationHistory.filter((m) => m.role === 'user').map((m) => m.content),
      ].join('\n');
      if (last.includes('<search_results>')) {
        let calId = 'c_work@group.calendar.google.com';
        if (last.includes('c_work@group.calendar.google.com')) {
          calId = 'c_work@group.calendar.google.com';
        } else if (last.includes('user@example.com')) {
          calId = 'user@example.com';
        } else {
          const match = last.match(/"id":\s*"([^"]+)"/);
          if (match?.[1]) calId = match[1];
        }
        if (/Daily Standup|Google Meet/i.test(allUserText)) {
          return JSON.stringify({
            kind: 'plan',
            thinking: 'Tạo lịch họp Daily Standup định kỳ kèm phòng họp Google Meet.',
            summary: 'Tạo lịch họp Daily Standup kèm Google Meet',
            warnings: [
              'Sự kiện "Daily Standup Kỹ thuật" (2026-10-28T09:00:00+07:00 - 2026-10-28T09:30:00+07:00) trùng giờ với: Họp giao ban (09:00 - 09:30). Gợi ý khung giờ trống trong ngày: 10:30–11:30, 11:30–12:30.',
            ],
            steps: [
              {
                id: 'create_event',
                tool: 'mycalendar.create_event',
                description: 'Tạo lịch họp Daily Standup Kỹ thuật',
                args: {
                  calendarId: calId,
                  summary: 'Daily Standup Kỹ thuật',
                  start: '2026-10-28T09:00:00+07:00',
                  end: '2026-10-28T09:30:00+07:00',
                  location: 'Phòng họp Tầng 5',
                  description: 'Cập nhật tiến độ Sprint',
                  createMeetLink: true,
                  recurrence: 'WEEKDAYS',
                },
                dependsOn: [],
              },
            ],
          });
        }
        return JSON.stringify({
          kind: 'plan',
          thinking: 'Tạo sự kiện trong lịch cá nhân.',
          summary: 'Tạo sự kiện lịch cá nhân',
          warnings: [],
          steps: [
            {
              id: 'create_event',
              tool: 'mycalendar.create_event',
              description: 'Tạo sự kiện họp',
              args: {
                calendarId: calId,
                summary: 'Họp việc riêng',
                start: '2026-10-28T09:00:00+07:00',
                end: '2026-10-28T10:00:00+07:00',
              },
              dependsOn: [],
            },
          ],
        });
      }
      return JSON.stringify(responses[0]);
    };
    return mockProvider;
  }
  if (scenario === 'mysheets') {
    const responses = [
      { kind: 'search', calls: [{ tool: 'mysheets.list_spreadsheets', args: { query: '' } }] },
      {
        kind: 'plan',
        thinking: 'Thêm dòng vào bảng tính cá nhân.',
        summary: 'Thêm dòng vào bảng tính cá nhân',
        warnings: [],
        steps: [
          {
            id: 'append_row',
            tool: 'mysheets.append_rows',
            description: 'Thêm dòng mới vào bảng tính',
            args: {
              spreadsheetId: 'sheet-personal-1',
              sheet: 'Sheet1',
              rows: [['Slide bảo vệ', '05/11']],
            },
            dependsOn: [],
          },
        ],
      },
    ];
    mockProvider.setPlanResponses(responses);
    const fallback = mockProvider.generatePlan.bind(mockProvider);
    mockProvider.generatePlan = async (input) => {
      if (!Array.isArray(input.conversationHistory)) return fallback(input);
      const userPrompt =
        input.conversationHistory
          .filter((m) => m.role === 'user' && !m.content.includes('<search_results>'))
          .at(-1)?.content ?? '';
      const isClosedLoop = /quy trình khép kín|Sprint 15/i.test(userPrompt);
      const last = input.conversationHistory.at(-1)?.content ?? '';
      if (last.includes('<search_results>')) {
        let sheetId = 'sheet-personal-1';
        const match = last.match(/"id":\s*"([^"]+)"/);
        if (match?.[1]) sheetId = match[1];
        if (isClosedLoop) {
          return JSON.stringify({
            kind: 'plan',
            thinking: 'Thực hiện quy trình khép kín 2 chiều trên bảng tính cá nhân.',
            summary: 'Tra cứu, Upsert, cập nhật cột chọn lọc và tạo tab Sprint 15',
            warnings: [],
            steps: [
              {
                id: 'search_step',
                tool: 'mysheets.search_rows',
                description: 'Lọc các dòng đã hoàn thành trong Sheet1',
                args: {
                  spreadsheetId: sheetId,
                  sheet: 'Sheet1',
                  column: 'Status',
                  operator: 'equals',
                  value: 'Done',
                  limit: 10,
                },
                dependsOn: [],
              },
              {
                id: 'upsert_step',
                tool: 'mysheets.append_rows',
                description: 'Đồng bộ dòng công việc (Upsert chống trùng khóa)',
                args: {
                  spreadsheetId: sheetId,
                  sheet: 'Sheet1',
                  rows: [['Write spec', 'In Review'], ['Slide bảo vệ', '05/11']],
                  deduplicate: true,
                  onDuplicate: 'update',
                },
                dependsOn: ['search_step'],
              },
              {
                id: 'update_step',
                tool: 'mysheets.update_rows',
                description: 'Cập nhật trạng thái dòng Write spec',
                args: {
                  spreadsheetId: sheetId,
                  sheet: 'Sheet1',
                  updates: [
                    {
                      matchColumn: 'Task',
                      matchValue: 'Write spec',
                      values: { Status: 'Verified' },
                    },
                  ],
                },
                dependsOn: ['upsert_step'],
              },
              {
                id: 'create_tab_step',
                tool: 'mysheets.create_sheet',
                description: 'Tạo trang tính Sprint 15 mới',
                args: {
                  spreadsheetId: sheetId,
                  title: 'Sprint 15',
                  headers: ['Mã thẻ', 'Trạng thái'],
                },
                dependsOn: ['update_step'],
              },
            ],
          });
        }
        return JSON.stringify({
          kind: 'plan',
          thinking: 'Thêm dòng vào bảng tính cá nhân.',
          summary: 'Thêm dòng vào bảng tính cá nhân',
          warnings: [],
          steps: [
            {
              id: 'append_row',
              tool: 'mysheets.append_rows',
              description: 'Thêm dòng mới vào bảng tính',
              args: {
                spreadsheetId: sheetId,
                sheet: 'Sheet1',
                rows: [['Slide bảo vệ', '05/11']],
              },
              dependsOn: [],
            },
          ],
        });
      }
      return JSON.stringify(responses[0]);
    };
    return mockProvider;
  }
  if (scenario === 'answer') {
    // Select by this conversation's context, not a global counter shared by users.
    mockProvider.generatePlan = async input => {
      if (input.conversationHistory.some(message => message.content.includes('<previous_answer>'))) return JSON.stringify({
        kind: 'plan', thinking: 'Send summary', summary: 'Gửi tóm tắt vào Slack', warnings: [],
        steps: [{ id: 'send', tool: 'slack.send_message', description: 'Gửi tóm tắt',
          args: { channel: '#general', text: 'Jira ATI-42: Login bug' }, dependsOn: [] }],
      });
      if (input.conversationHistory.at(-1)?.content.includes('<search_results>')) return JSON.stringify({
        kind: 'answer', text: 'Jira ATI-42: Login bug — Open.\n<b>x</b> https://a.example',
      });
      return JSON.stringify({ kind: 'search', calls: [{ tool: 'jira.search_issues', args: { projectKey: 'ATI', query: 'Login' } }] });
    };
    return mockProvider;
  }
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
  const jiraPlan = {
    kind: 'plan', thinking: 'Tạo ticket Jira trong project đã tìm thấy và chuyển key/URL sang thông báo Slack.',
    summary: 'Tạo ticket Jira và thông báo Slack', warnings: [],
    steps: [
      { id: 'step_1', tool: 'jira.create_issue', description: 'Tạo ticket lỗi đăng nhập', args: { projectKey: 'ATI', summary: 'Login bug', description: 'Mô tả thuần trong sandbox' }, dependsOn: [] },
      { id: 'step_2', tool: 'slack.send_message', description: 'Thông báo key và liên kết ticket', args: { channel: '#general', text: { $template: 'Jira: ${step_1.output.key}; ${step_1.output.url}' } }, dependsOn: ['step_1'] },
    ],
  };
  const fourServicePlan = {
    kind: 'plan',
    thinking: 'Tạo ticket sự cố trên Jira, lập trang biên bản trên Notion kèm mã và liên kết Jira, gửi cảnh báo trực ca qua Telegram, rồi đăng tổng hợp vào kênh Slack.',
    summary: 'Điều phối sự cố qua 4 dịch vụ: Jira, Notion, Telegram và Slack',
    warnings: [],
    steps: [
      {
        id: 'step_1',
        tool: 'jira.create_issue',
        description: 'Tạo ticket sự cố thanh toán P1 trên Jira',
        args: { projectKey: 'ATI', summary: 'Sự cố thanh toán P1', description: 'Mô tả sự cố P1 trong sandbox' },
        dependsOn: [],
      },
      {
        id: 'step_2',
        tool: 'notion.create_page',
        description: 'Lập trang biên bản sự cố trên Notion dẫn tới Jira',
        args: {
          databaseId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          title: 'Biên bản sự cố P1',
          content: { $template: 'Theo dõi Jira ${step_1.output.key}: ${step_1.output.url}' },
        },
        dependsOn: ['step_1'],
      },
      {
        id: 'step_3',
        tool: 'telegram.send_message',
        description: 'Gửi cảnh báo trực ca qua Telegram kèm liên kết biên bản',
        args: {
          chatId: '-1001234567890',
          text: { $template: 'Cảnh báo trực ca ${step_1.output.key}: ${step_2.output.url}' },
        },
        dependsOn: ['step_1', 'step_2'],
      },
      {
        id: 'step_4',
        tool: 'slack.send_message',
        description: 'Thông báo tổng hợp 4 dịch vụ vào kênh Slack #general',
        args: {
          channel: '#general',
          text: { $template: 'Jira: ${step_1.output.key} (${step_1.output.url}); Notion: ${step_2.output.url}; Telegram: ${step_3.output.messageId}' },
        },
        dependsOn: ['step_1', 'step_2', 'step_3'],
      },
    ],
  };
  const fiveServicePlan = {
    kind: 'plan',
    thinking: 'Tạo ticket phát hành trên Jira, mở issue theo dõi trên GitHub, tạo thẻ triển khai trên Trello, ghi dòng theo dõi vào Google Sheets và báo tổng hợp lên kênh Slack.',
    summary: 'Đồng bộ phát hành Sprint qua 5 dịch vụ: Jira, GitHub, Trello, Sheets và Slack',
    warnings: [],
    steps: [
      {
        id: 'step_1',
        tool: 'jira.create_issue',
        description: 'Tạo ticket phát hành trên Jira',
        args: { projectKey: 'ATI', summary: 'Release Sprint 15', description: 'Phát hành phiên bản mới' },
        dependsOn: [],
      },
      {
        id: 'step_2',
        tool: 'github.create_issue',
        description: 'Mở issue phát hành trên GitHub tham chiếu Jira',
        args: {
          repo: 'owner/repo',
          title: 'Release checklist Sprint 15',
          body: { $template: 'Theo dõi Jira ${step_1.output.key}: ${step_1.output.url}' },
        },
        dependsOn: ['step_1'],
      },
      {
        id: 'step_3',
        tool: 'trello.create_card',
        description: 'Tạo thẻ triển khai trên Trello đính kèm link GitHub',
        args: {
          listId: 'list_frontend_todo',
          title: 'Triển khai Release Sprint 15',
          desc: { $template: 'Jira: ${step_1.output.key} | GitHub: ${step_2.output.url}' },
        },
        dependsOn: ['step_1', 'step_2'],
      },
      {
        id: 'step_4',
        tool: 'sheets.append_rows',
        description: 'Ghi nhật ký phát hành vào bảng tính Google Sheets',
        args: {
          spreadsheetId: 'spreadsheet_fixture_123456',
          sheet: 'Tasks',
          rows: [[{ $template: '${step_1.output.key}' }, { $template: '${step_3.output.url}' }]],
        },
        dependsOn: ['step_1', 'step_3'],
      },
      {
        id: 'step_5',
        tool: 'slack.send_message',
        description: 'Thông báo tổng hợp 5 dịch vụ lên kênh Slack #general',
        args: {
          channel: '#general',
          text: { $template: 'Release ${step_1.output.key}: GitHub=${step_2.output.url}; Trello=${step_3.output.url}; Sheets=${step_4.output.updatedRange}' },
        },
        dependsOn: ['step_1', 'step_2', 'step_3', 'step_4'],
      },
    ],
  };
  const nineServicePlan = {
    kind: 'plan',
    thinking: 'Điều phối quy trình liên thông qua đủ 9 dịch vụ: tạo lịch họp Google Calendar, tạo ticket Jira, mở issue GitHub, tạo thẻ Trello, lập biên bản Notion, ghi dòng nhật ký Google Sheets, gửi email báo cáo Gmail, bắn cảnh báo Telegram và đăng tổng hợp lên Slack.',
    summary: 'Điều phối liên thông toàn diện 9 dịch vụ từ lịch họp đến báo cáo tổng hợp',
    warnings: [],
    steps: [
      {
        id: 'step_1',
        tool: 'calendar.create_event',
        description: 'Tạo lịch họp khẩn xử lý sự cố trên Google Calendar',
        args: {
          calendarId: 'ati@group.calendar.google.com',
          summary: 'Họp khẩn sự cố P1',
          start: '2026-10-09T15:00:00+07:00',
          end: '2026-10-09T16:00:00+07:00',
        },
        dependsOn: [],
      },
      {
        id: 'step_2',
        tool: 'jira.create_issue',
        description: 'Tạo ticket sự cố trên Jira kèm liên kết lịch họp',
        args: {
          projectKey: 'ATI',
          summary: 'Sự cố thanh toán P1',
          description: { $template: 'Lịch họp khẩn: ${step_1.output.url}' },
        },
        dependsOn: ['step_1'],
      },
      {
        id: 'step_3',
        tool: 'github.create_issue',
        description: 'Mở issue kỹ thuật trên GitHub tham chiếu mã Jira',
        args: {
          repo: 'owner/repo',
          title: 'Hotfix sự cố thanh toán P1',
          body: { $template: 'Theo dõi Jira ${step_2.output.key}: ${step_2.output.url}' },
        },
        dependsOn: ['step_2'],
      },
      {
        id: 'step_4',
        tool: 'trello.create_card',
        description: 'Tạo thẻ theo dõi trên Trello đính kèm GitHub issue',
        args: {
          listId: 'list_frontend_todo',
          title: 'Theo dõi vá lỗi thanh toán P1',
          desc: { $template: 'GitHub: ${step_3.output.url} | Jira: ${step_2.output.key}' },
        },
        dependsOn: ['step_2', 'step_3'],
      },
      {
        id: 'step_5',
        tool: 'notion.create_page',
        description: 'Lập trang biên bản sự cố trên Notion tổng hợp các liên kết',
        args: {
          databaseId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          title: 'Biên bản sự cố P1',
          content: { $template: 'Jira: ${step_2.output.url} | GitHub: ${step_3.output.url} | Trello: ${step_4.output.url}' },
        },
        dependsOn: ['step_2', 'step_3', 'step_4'],
      },
      {
        id: 'step_6',
        tool: 'sheets.append_rows',
        description: 'Ghi dòng nhật ký SLA vào bảng tính Google Sheets',
        args: {
          spreadsheetId: 'spreadsheet_fixture_123456',
          sheet: 'Tasks',
          rows: [[{ $template: '${step_2.output.key}' }, { $template: '${step_5.output.url}' }]],
        },
        dependsOn: ['step_2', 'step_5'],
      },
      {
        id: 'step_7',
        tool: 'gmail.send_message',
        description: 'Gửi email báo cáo ban điều hành qua Gmail',
        args: {
          to: ['oncall@ati.local'],
          subject: 'Báo cáo sự cố thanh toán P1',
          body: { $template: 'Biên bản Notion: ${step_5.output.url} | Vùng Sheets: ${step_6.output.updatedRange}' },
        },
        dependsOn: ['step_5', 'step_6'],
      },
      {
        id: 'step_8',
        tool: 'telegram.send_message',
        description: 'Gửi cảnh báo trực ca qua Telegram kèm mã thư Gmail',
        args: {
          chatId: '-1001234567890',
          text: { $template: 'Cảnh báo ${step_2.output.key}: Biên bản ${step_5.output.url} | Email ${step_7.output.id}' },
        },
        dependsOn: ['step_2', 'step_5', 'step_7'],
      },
      {
        id: 'step_9',
        tool: 'slack.send_message',
        description: 'Đăng bản tổng hợp toàn bộ 9 dịch vụ vào kênh Slack #general',
        args: {
          channel: '#general',
          text: { $template: 'Calendar: ${step_1.output.url}; Jira: ${step_2.output.key}; GitHub: ${step_3.output.url}; Trello: ${step_4.output.url}; Notion: ${step_5.output.url}; Sheets: ${step_6.output.updatedRange}; Gmail: ${step_7.output.id}; Telegram: ${step_8.output.messageId}' },
        },
        dependsOn: ['step_1', 'step_2', 'step_3', 'step_4', 'step_5', 'step_6', 'step_7', 'step_8'],
      },
    ],
  };
  if (scenario === 'schedule') {
    const meeting = { name: 'Lịch họp hằng ngày', request: 'Gửi lịch họp hôm nay lên Slack #ati-test' };
    // Select by this conversation's last request, not a global counter shared by users.
    mockProvider.generatePlan = async input => {
      const text = input.conversationHistory.filter(message => message.role === 'user').at(-1)?.content ?? '';
      if (text.includes('(Lượt chạy theo lịch')) return JSON.stringify(calendarPlan);
      if (text.startsWith('Đổi sang')) return JSON.stringify({ kind: 'schedule', action: 'update', ...meeting,
        recurrence: { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] }, summary: 'Đổi sang 8 giờ 30, từ thứ Hai đến thứ Sáu.' });
      if (text.startsWith('Tạm dừng')) return JSON.stringify({ kind: 'schedule', action: 'pause', summary: 'Tạm dừng lịch họp hằng ngày.' });
      if (text.startsWith('Chạy tiếp')) return JSON.stringify({ kind: 'schedule', action: 'resume', summary: 'Chạy tiếp lịch họp hằng ngày.' });
      if (text.startsWith('Hủy lịch')) return JSON.stringify({ kind: 'schedule', action: 'cancel', summary: 'Hủy lịch họp hằng ngày.' });
      if (/trello/i.test(text)) return JSON.stringify({
        kind: 'schedule',
        action: 'create',
        name: 'Bản tin Trello sáng',
        request: 'Gửi bản tin Trello bảng Sprint Board lên Slack #general',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi sáng 8 giờ, gửi bản tin Trello bảng Sprint Board lên Slack #general.',
      });
      if (/github|bản tin/i.test(text)) return JSON.stringify({
        kind: 'schedule',
        action: 'create',
        name: 'Bản tin GitHub sáng',
        request: 'Gửi bản tin GitHub repo owner/repo lên Slack #general',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi sáng 8 giờ, gửi bản tin GitHub repo owner/repo lên Slack #general.',
      });
      return JSON.stringify({ kind: 'schedule', action: 'create', ...meeting, recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test.' });
    };
    return mockProvider;
  }
  mockProvider.setPlanResponses([
    scenario === 'nine_service'
      ? nineServicePlan
      : scenario === 'five_service'
        ? fiveServicePlan
        : scenario === 'four_service'
          ? fourServicePlan
          : scenario === 'jira_slack'
            ? jiraPlan
            : scenario === 'telegram_slack'
              ? telegramPlan
              : scenario === 'notion_slack'
                ? notionPlan
                : scenario === 'calendar_slack'
                  ? calendarPlan
                  : scenario === 'sheets_slack'
                    ? sheetsPlan
                    : scenario === 'three_service'
                      ? threeServicePlan
                      : sandboxPlan,
  ]);
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
