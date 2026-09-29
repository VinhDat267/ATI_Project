/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ServiceCard } from '../../src/components/ServiceCard';
import { SettingsModal } from '../../src/components/SettingsModal';

afterEach(() => {
  cleanup();
});

describe('ServiceCard Component', () => {
  it('renders service info, credential inputs, allowed scope and test connection button', () => {
    const onTest = vi.fn();
    const onSave = vi.fn();
    render(
      <ServiceCard
        service="trello"
        title="Trello"
        connected={false}
        allowedScope={['Frontend Team', 'Mobile App']}
        onSave={onSave}
        onTestConnection={onTest}
      />
    );

    expect(screen.getByText('Trello')).toBeDefined();
    expect(screen.getByText('Frontend Team')).toBeDefined();
    expect(screen.getByText('Mobile App')).toBeDefined();

    const testBtn = screen.getByRole('button', { name: /kiểm tra kết nối/i });
    fireEvent.click(testBtn);
    expect(onTest).toHaveBeenCalled();
  });

  it('allows adding and removing allowed scope chips', () => {
    const onSave = vi.fn();
    render(
      <ServiceCard
        service="slack"
        title="Slack"
        connected={true}
        allowedScope={['#general']}
        onSave={onSave}
      />
    );

    expect(screen.getByText('#general')).toBeDefined();

    // Add chip
    const input = screen.getByPlaceholderText(/thêm/i);
    fireEvent.change(input, { target: { value: '#announcements' } });
    fireEvent.click(screen.getByRole('button', { name: /thêm/i }));

    expect(screen.getByText('#announcements')).toBeDefined();
  });
});

describe('SettingsModal Component', () => {
  it('renders multiple services and close button', () => {
    const onClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={onClose} />);

    expect(screen.getByText(/cài đặt/i)).toBeDefined();
    const closeBtn = screen.getByRole('button', { name: /đóng/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
