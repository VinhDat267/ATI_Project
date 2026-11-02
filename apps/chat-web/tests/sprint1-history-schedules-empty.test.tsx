// PBI-05 (Sprint 1): /history luôn có mục "Lịch chạy" khi máy chủ bật lịch chạy, kể cả khi
// GET /api/schedules trả {"schedules":[]}. Trạng thái rỗng chỉ nói điều mã nguồn làm thật:
// lịch được lưu khi người dùng bấm "Xác nhận" trên đề xuất lịch chạy trong Không gian làm việc
// (POST /api/conversations/:convId/schedule-proposals/:messageId/confirm).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ScheduleSection } from '../src/pages/History/ScheduleSection';
import { SchedulesCapabilityContext } from '../src/hooks/use-schedules';
import { apiClient } from '../src/services/api-client';

const user = { id: 'u1', name: 'An', email: 'an@example.test' };
function view(enabled = true) {
  const navigate = vi.fn();
  render(<SchedulesCapabilityContext.Provider value={enabled}><ScheduleSection user={user} navigate={navigate} /></SchedulesCapabilityContext.Provider>);
  return { navigate };
}
beforeEach(() => { vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: [] }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('PBI-05: mục Lịch chạy khi chưa có lịch', () => {
  it('vẫn hiện mục Lịch chạy với trạng thái rỗng giải thích cách tạo lịch và nút về Không gian làm việc', async () => {
    const { navigate } = view();
    const section = await screen.findByRole('region', { name: 'Lịch chạy' });
    expect(within(section).getByRole('heading', { level: 3, name: 'Chưa có lịch chạy nào' })).toBeInTheDocument();
    expect(section).toHaveTextContent(/Không gian làm việc/);
    expect(section).toHaveTextContent(/Mỗi sáng 08:00/);
    expect(section).toHaveTextContent(/chỉ được lưu sau khi bạn bấm Xác nhận/);
    const cta = within(section).getByRole('link', { name: 'Mở Không gian làm việc' });
    expect(cta).toHaveAttribute('href', '/');
    fireEvent.click(cta);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('không chớp trạng thái rỗng trong lúc đang tải danh sách lịch', async () => {
    let resolve!: (value: { schedules: [] }) => void;
    vi.mocked(apiClient.getSchedules).mockImplementation(() => new Promise(done => { resolve = done; }));
    view();
    const section = await screen.findByRole('region', { name: 'Lịch chạy' });
    expect(within(section).getByRole('status')).toHaveTextContent('Đang tải lịch chạy…');
    expect(within(section).queryByText('Chưa có lịch chạy nào')).toBeNull();
    await act(async () => resolve({ schedules: [] }));
    expect(within(section).getByText('Chưa có lịch chạy nào')).toBeInTheDocument();
  });

  it('không nhầm lỗi tải với "chưa có lịch"', async () => {
    vi.mocked(apiClient.getSchedules).mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    view();
    const section = await screen.findByRole('region', { name: 'Lịch chạy' });
    expect(await within(section).findByRole('alert')).toHaveTextContent('Không tải được lịch chạy.');
    expect(within(section).queryByText('Chưa có lịch chạy nào')).toBeNull();
  });

  it('vẫn ẩn hẳn mục và không gọi API khi máy chủ không bật lịch chạy', async () => {
    view(false);
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'Lịch chạy' })).toBeNull();
    expect(apiClient.getSchedules).not.toHaveBeenCalled();
  });
});
