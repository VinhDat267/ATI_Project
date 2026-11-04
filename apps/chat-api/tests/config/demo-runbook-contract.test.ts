import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createSandboxProvider } from '../../src/sandbox/scenarios.js';
import { AIPlanner, WorkingMemory, validatePlan } from '@wap/planner';
import { ALL_TOOLS, GMAIL_SERVICE, GMAIL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';

const repoRoot = resolve(import.meta.dirname, '../../../..');

describe('DEMO-01: Cross-Service End-to-End Audit & Defense Runbook Contract', () => {
  it('validates four_service, five_service, and nine_service sandbox scenarios against validatePlan and AIPlanner', async () => {
    const fullCatalog = [...ALL_TOOLS, ...GMAIL_TOOLS];

    for (const [name, expectedSteps, prompt] of [
      [
        'four_service',
        4,
        'Tạo ticket sự cố thanh toán P1 trên Jira, lập trang biên bản sự cố trên Notion kèm mã và liên kết Jira, gửi cảnh báo trực ca qua Telegram kèm liên kết biên bản và đăng tổng hợp vào kênh Slack #general',
      ],
      [
        'five_service',
        5,
        'Tạo ticket phát hành trên Jira, mở issue checklist trên GitHub tham chiếu mã Jira, tạo thẻ triển khai trên Trello đính kèm link GitHub, ghi nhật ký phát hành vào bảng tính Google Sheets và gửi thông báo tổng hợp vào kênh Slack #general',
      ],
      [
        'nine_service',
        9,
        'Tạo lịch họp khẩn trên Google Calendar, tạo ticket sự cố trên Jira kèm link lịch họp, mở issue trên GitHub tham chiếu mã Jira, tạo thẻ theo dõi trên Trello, lập trang biên bản sự cố trên Notion tổng hợp các liên kết, ghi dòng nhật ký vào bảng tính Google Sheets, gửi email báo cáo qua Gmail tới oncall@ati.local, gửi cảnh báo trực ca qua Telegram và đăng tổng hợp toàn bộ vào kênh Slack #general',
      ],
    ] as const) {
      const provider = createSandboxProvider(name);
      const rawResponse = await provider.generatePlan({
        systemPrompt: '',
        conversationHistory: [{ role: 'user', content: prompt }],
        toolCatalog: fullCatalog,
        workingMemory: {},
      });

      const validation = validatePlan(rawResponse, fullCatalog);
      expect(validation).toMatchObject({ valid: true });

      const aiPlanner = new AIPlanner({
        provider: createSandboxProvider(name),
        toolCatalog: fullCatalog,
        serviceRegistry: [...SERVICE_REGISTRY, GMAIL_SERVICE],
        requireGroundedResources: false,
        prefetchDirectory: false,
        searchMode: 'llm',
      });
      const planned = await aiPlanner.processMessage({
        userMessage: prompt,
        memory: new WorkingMemory(),
      });
      expect(planned.kind).toBe('plan');
      if (planned.kind === 'plan') {
        expect(planned.steps).toHaveLength(expectedSteps);
      }
    }
  });

  it('keeps DEMO-RUNBOOK.md complete, actionable, and free of real credentials', () => {
    const runbookPath = resolve(repoRoot, 'docs/demo/DEMO-RUNBOOK.md');
    expect(existsSync(runbookPath)).toBe(true);

    const content = readFileSync(runbookPath, 'utf8');
    expect(content).toContain('## 1. Máy Trạm, Phần Mềm & Cổng Dịch Vụ');
    expect(content).toContain('## 2. Cấu Hình Cờ Tính Năng (`.env`) & Khởi Tạo Từ Đầu');
    expect(content).toContain('## 3. Ba Kịch Bản Chính + Kịch Bản Flagship 9 Dịch Vụ');
    expect(content).toContain('## 4. Dọn Dẹp Tài Nguyên Thử Nghiệm Sau Mỗi Lượt Chạy');
    expect(content).toContain('## 5. Quy Trình Chuyển Đổi LLM Dự Phòng');
    expect(content).toContain('## 6. Kịch Bản Xử Lý Sự Cố Khẩn Cấp');
    expect(content).toContain('## 7. Checklist 15 Phút Trước Giờ Bảo Vệ');

    // Verify all 5 feature flags, pinned LLM model, and key scenarios are documented
    expect(content).toContain('LLM_MODEL=ag/gemini-3.8-flash');
    expect(content).toContain('LLM_MODEL=cx/gpt-6.1-sol');
    expect(content).toContain('PLANNER_READ_ANSWERS=on');
    expect(content).toContain('SCHEDULES_ENABLED=on');
    expect(content).toContain('GMAIL_ENABLED=on');
    expect(content).toContain('MYCALENDAR_ENABLED=on');
    expect(content).toContain('MYSHEETS_ENABLED=on');
    expect(content).toContain('MYNOTION_ENABLED=on');
    expect(content).toContain('MYJIRA_ENABLED=on');
    expect(content).toContain('MYSLACK_ENABLED=on');
    expect(content).toContain('MYSLACK_WRITES_ENABLED=on');
    expect(content).toContain('MYSLACK_AUTOMATION_ENABLED=on');
    expect(content).toContain('SANDBOX_SCENARIO=nine_service');

    // Verify no real tokens/secrets are accidentally committed in the runbook
    expect(content).not.toMatch(/xox[baprs]-[0-9a-zA-Z-]{10,}/);
    expect(content).not.toMatch(/ghp_[0-9a-zA-Z]{20,}/);
    expect(content).not.toMatch(/ntn_[0-9a-zA-Z]{20,}/);
    expect(content).not.toMatch(/GOCSPX-[0-9a-zA-Z_-]{15,}/);
  });
});
