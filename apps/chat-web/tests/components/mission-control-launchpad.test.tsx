/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MissionControlLaunchpad } from '../../src/components/MissionControlLaunchpad';

afterEach(() => {
  cleanup();
});

describe('MissionControlLaunchpad Component', () => {
  it('renders live integrations status bar with 4 core services', () => {
    render(<MissionControlLaunchpad onSendMessage={vi.fn()} />);

    expect(
      screen.getByText(/Hệ thống kết nối liên dịch vụ/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Trello')).toBeInTheDocument();
    expect(screen.getByText('Slack')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Google Sheets')).toBeInTheDocument();
  });

  it('renders hero title, description, and security safeguards', () => {
    render(<MissionControlLaunchpad onSendMessage={vi.fn()} />);

    expect(
      screen.getByText('Trung Tâm Điều Phối Quy Trình Tự Động Hóa')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/toàn quyền kiểm duyệt trước khi chạy và dữ liệu luôn được bảo vệ an toàn/i)
    ).toBeInTheDocument();

    // Safeguard badges
    expect(screen.getByText('Kiểm duyệt trước khi chạy')).toBeInTheDocument();
    expect(screen.getByText('Bảo vệ dữ liệu tuyệt đối')).toBeInTheDocument();
    expect(screen.getByText('Dừng khẩn cấp & Phục hồi')).toBeInTheDocument();
  });

  it('renders 4 blueprint workflow launchpad cards and triggers onSendMessage on click', () => {
    const onSend = vi.fn();
    render(<MissionControlLaunchpad onSendMessage={onSend} />);

    // Blueprint 1
    const card1Btn = screen.getByText(
      /✨ Tạo công việc trên Trello, phân công nhân sự và thông báo qua Slack/i
    );
    expect(card1Btn).toBeInTheDocument();
    fireEvent.click(card1Btn);
    expect(onSend).toHaveBeenCalledWith(
      'Tạo công việc trên Trello, phân công nhân sự và thông báo qua Slack'
    );

    // Blueprint 2
    const card2Btn = screen.getByText(
      /🔍 Kiểm tra danh sách bảng việc Trello và kênh Slack liên kết/i
    );
    expect(card2Btn).toBeInTheDocument();
    fireEvent.click(card2Btn);
    expect(onSend).toHaveBeenCalledWith(
      'Kiểm tra danh sách bảng việc Trello và kênh Slack liên kết'
    );

    // Blueprint 3
    const card3Btn = screen.getByText(/🚀 Phát hành Sprint từ Trello sang Slack/i);
    expect(card3Btn).toBeInTheDocument();
    fireEvent.click(card3Btn);
    expect(onSend).toHaveBeenCalledWith(
      'Tạo thông báo phát hành sprint từ Trello sang Slack channel #general và cập nhật trạng thái các task'
    );

    // Blueprint 4
    const card4Btn = screen.getByText(/📊 Xuất báo cáo tiến độ tuần & Gửi Slack/i);
    expect(card4Btn).toBeInTheDocument();
    fireEvent.click(card4Btn);
    expect(onSend).toHaveBeenCalledWith(
      'Kiểm tra các task đang thực hiện trên Trello và tạo bản tin tóm tắt tiến độ gửi qua Slack channel #general'
    );
  });

  it('allows typing and executing commands via the Hero Command Bar', () => {
    const onSend = vi.fn();
    render(<MissionControlLaunchpad onSendMessage={onSend} />);

    const commandInput = screen.getByLabelText('Khung lệnh điều phối quy trình');
    expect(commandInput).toBeInTheDocument();

    fireEvent.change(commandInput, {
      target: { value: 'Khởi tạo quy trình phát hành sprint 4.2' },
    });

    const submitBtn = screen.getByRole('button', { name: /thực thi quy trình/i });
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);
    expect(onSend).toHaveBeenCalledWith(
      'Khởi tạo quy trình phát hành sprint 4.2'
    );

    // Input should be cleared after dispatch
    expect((commandInput as HTMLInputElement).value).toBe('');
  });

  it('inserts service tag when tag button is clicked in the Hero Command Bar', () => {
    render(<MissionControlLaunchpad onSendMessage={vi.fn()} />);

    const commandInput = screen.getByLabelText(
      'Khung lệnh điều phối quy trình'
    ) as HTMLInputElement;
    const trelloTagBtn = screen.getByRole('button', { name: '@Trello' });

    fireEvent.click(trelloTagBtn);
    expect(commandInput.value).toBe('@Trello ');

    const slackTagBtn = screen.getByRole('button', { name: '@Slack' });
    fireEvent.click(slackTagBtn);
    expect(commandInput.value).toBe('@Trello @Slack ');
  });
});
