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
  mockProvider.setPlanResponses([scenario === 'three_service' ? threeServicePlan : sandboxPlan]);
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
