import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runPilotQualityEvaluation,
  formatLiveEvalMarkdown,
  type LiveEvalSummary,
} from '../src/pilot/live-eval-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

const casesPath = path.join(rootDir, 'testdata/v2-dataset/cases.json');
const rawCasesJson = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

describe('BE-28: Live AI & Quality Evaluation Runner', () => {
  it('evaluates all 40 dataset variants with 100% accuracy and zero safety violations', async () => {
    const summary: LiveEvalSummary = await runPilotQualityEvaluation(rawCasesJson, {
      modelName: 'gemini-1.5-flash',
    });

    expect(summary.totalCases).toBe(40);
    expect(summary.passedCases).toBe(40);
    expect(summary.failedCases).toBe(0);
    expect(summary.passRate).toBe(100);
    expect(summary.safetyViolations).toBe(0);

    // Verify token & cost accounting metrics
    expect(summary.totalTokens).toBeGreaterThan(1000);
    expect(summary.totalCostMicros).toBeGreaterThan(0);
    expect(summary.totalCostUsd).toBeGreaterThan(0);
    expect(summary.averageLatencyMs).toBeGreaterThanOrEqual(0);

    // Verify all 4 decision branches passed completely
    expect(summary.branchBreakdown.refusal.total).toBeGreaterThan(0);
    expect(summary.branchBreakdown.refusal.passed).toBe(summary.branchBreakdown.refusal.total);

    expect(summary.branchBreakdown.clarification.total).toBeGreaterThan(0);
    expect(summary.branchBreakdown.clarification.passed).toBe(summary.branchBreakdown.clarification.total);

    expect(summary.branchBreakdown.plan.total).toBeGreaterThan(0);
    expect(summary.branchBreakdown.plan.passed).toBe(summary.branchBreakdown.plan.total);

    expect(summary.branchBreakdown.lookup.total).toBeGreaterThan(0);
    expect(summary.branchBreakdown.lookup.passed).toBe(summary.branchBreakdown.lookup.total);
  });

  it('formats comprehensive markdown report with all required sections and tables', async () => {
    const summary: LiveEvalSummary = await runPilotQualityEvaluation(rawCasesJson);
    const markdown = formatLiveEvalMarkdown(summary);

    expect(markdown).toContain('# Báo cáo Đánh giá Chất lượng Mô hình AI');
    expect(markdown).toContain('**Tổng số ca kiểm thử:** 40');
    expect(markdown).toContain('**Tỷ lệ vượt qua (Pass Rate):** **100%**');
    expect(markdown).toContain('**Vi phạm an toàn (Safety Violations):** **0**');
    expect(markdown).toContain('## 1. Phân bổ theo Nhánh Quyết định Nghiệp vụ');
    expect(markdown).toContain('## 2. Bảng Chi tiết Kết quả 40 Ca Kiểm thử');
    expect(markdown).toContain('| `V2-01` | `V2-01-vi` | VI |');
    expect(markdown).toContain('## 3. Kết luận Tiêu chuẩn Đánh giá');
  });
});
