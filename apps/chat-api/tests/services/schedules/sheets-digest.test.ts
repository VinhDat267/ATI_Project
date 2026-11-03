import { describe, expect, it } from 'vitest';
import { analyzeSheetKpiMetrics } from '../../../src/services/schedules/sheets-digest-runner.js';

describe('Sheets Digest KPI Analyzer (Task 4: Deadline Overdue Detection & Smart Highlights)', () => {
  it('flags in-progress or pending rows with past deadlines as overdue and prioritizes them over old completed rows in highlights', () => {
    const headers = ['Hạng mục', 'Trạng thái', 'Hạn chót', 'Ngân sách'];
    const records = [
      { 'Hạng mục': 'Task cũ 1', 'Trạng thái': 'Hoàn thành', 'Hạn chót': '01/09/2026', 'Ngân sách': '10.000.000 đ' },
      { 'Hạng mục': 'Task cũ 2', 'Trạng thái': 'Hoàn thành', 'Hạn chót': '05/09/2026', 'Ngân sách': '15.000.000 đ' },
      { 'Hạng mục': 'Task cũ 3', 'Trạng thái': 'Hoàn thành', 'Hạn chót': '10/09/2026', 'Ngân sách': '20.000.000 đ' },
      { 'Hạng mục': 'Task cũ 4', 'Trạng thái': 'Hoàn thành', 'Hạn chót': '12/09/2026', 'Ngân sách': '5.000.000 đ' },
      { 'Hạng mục': 'Task cũ 5', 'Trạng thái': 'Hoàn thành', 'Hạn chót': '15/09/2026', 'Ngân sách': '8.000.000 đ' },
      { 'Hạng mục': 'Chốt hợp đồng Khách A', 'Trạng thái': 'Đang làm', 'Hạn chót': '01/10/2026', 'Ngân sách': '50.000.000 đ' },
      { 'Hạng mục': 'Triển khai Kampaign Q4', 'Trạng thái': 'Đang làm', 'Hạn chót': '25/12/2026', 'Ngân sách': '30.000.000 đ' },
    ];

    const now = new Date('2026-10-15T09:00:00Z');
    const metrics = analyzeSheetKpiMetrics(headers, records, [], now);

    expect(metrics.totalRows).toBe(7);
    expect(metrics.doneCount).toBe(5);
    // "Chốt hợp đồng Khách A" has deadline 01/10/2026 < 15/10/2026 so it is overdue!
    expect(metrics.overdueOrPendingCount).toBe(1);
    expect(metrics.inProgressCount).toBe(1);

    // Overdue and active items should be prioritized in highlights instead of the first 5 old "Hoàn thành" rows
    expect(metrics.highlights[0]).toContain('Chốt hợp đồng Khách A');
    expect(metrics.highlights[0]).toContain('🚨 [Quá hạn');
    expect(metrics.highlights.some((h) => h.includes('Triển khai Kampaign Q4'))).toBe(true);
  });
});
