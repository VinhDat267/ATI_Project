/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MissionControlLaunchpad as Launchpad, BLUEPRINTS } from '../../src/components/MissionControlLaunchpad';

import { ALL_TOOLS } from '@wap/tool-schemas';
const services = ['trello','slack','github'].map(id=>({id,name:id==='github'?'GitHub':id==='slack'?'Slack':'Trello',connected:true,configured:true,connectionStatus:'healthy',tools:ALL_TOOLS.filter(t=>t.service===id).map(t=>t.name)}));
const MissionControlLaunchpad = (props:any) => <Launchpad services={services} runtimeMode="live" {...props} />;
it('references only registered services and existing tools in every blueprint', () => {
  for (const blueprint of BLUEPRINTS) for (const name of blueprint.requiredTools) {
    const tool = ALL_TOOLS.find(tool => tool.name === name);
    expect(tool).toBeDefined();
    expect(services.find(service => service.id === tool!.service)).toBeDefined();
  }
});

afterEach(() => {
  cleanup();
});

describe('MissionControlLaunchpad Component', () => {
  it('renders live integrations status bar from the API catalog', () => {
    render(<MissionControlLaunchpad onSendMessage={vi.fn()} />);

    expect(
      screen.getByText(/Hệ thống kết nối liên dịch vụ/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Trello')).toBeInTheDocument();
    expect(screen.getByText('Slack')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.queryByText('Google Sheets')).toBeNull();
  });

  it('renders hero title, description, and security safeguards', () => {
    render(<MissionControlLaunchpad onSendMessage={vi.fn()} />);

    expect(
      screen.getByText('Trung Tâm Điều Phối Quy Trình Tự Động Hóa')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/phê duyệt các lệnh ghi trước khi chạy/i)
    ).toBeInTheDocument();

    // Safeguard badges
    expect(screen.getByText('Kiểm duyệt trước khi chạy')).toBeInTheDocument();
    expect(screen.getByText('Giới hạn phạm vi dịch vụ')).toBeInTheDocument();
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
    const card3Btn = screen.getByText(/🚀 Tạo công việc từ GitHub issue sang Trello & Slack/i);
    expect(card3Btn).toBeInTheDocument();
    fireEvent.click(card3Btn);
    expect(onSend).toHaveBeenCalledWith(
      'Tìm issue trên GitHub, tạo thẻ Trello cho issue đã chọn và thông báo qua Slack'
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

it('uses configured counts, disables unconfigured blueprints and never shows LIVE in sandbox',()=>{
  render(<MissionControlLaunchpad services={services.map(s=>s.id==='github'?{...s,configured:false,connected:false}:s)} runtimeMode="sandbox" onSendMessage={vi.fn()} />);
  expect(screen.getByText('2/3 dịch vụ đã cấu hình')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Cần kết nối GitHub/})).toBeDisabled();
  expect(screen.queryByText(/LIVE/)).toBeNull();
  expect(screen.queryByText(/Google Sheets/)).toBeNull();
});
it('hides samples and service tags that require an absent service/tool',()=>{
  render(<MissionControlLaunchpad services={services.filter(s=>s.id!=='github')} onSendMessage={vi.fn()} />);
  expect(screen.queryByRole('button',{name:/GitHub issue/})).toBeNull();
  expect(screen.queryByRole('button',{name:'@GitHub'})).toBeNull();
});
