import { afterEach, expect, it, vi } from 'vitest';
import { within, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ALL_TOOLS, GMAIL_TOOLS } from '@wap/tool-schemas';
import { GuidePage } from '../src/pages/Guide/GuidePage';
import { LandingPage } from '../src/pages/Landing/LandingPage';
import { GMAIL_PROMPTS } from '../src/pages/Guide/gmail-data';
import { SAMPLE_PROMPTS } from '../src/pages/Guide/data';
import { apiClient } from '../src/services/api-client';
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });
it('uses only available tools in the enabled and disabled guide sample catalogues', () => {
  const base = new Set(ALL_TOOLS.map(tool => tool.name)), enabled = new Set([...ALL_TOOLS, ...GMAIL_TOOLS].map(tool => tool.name));
  for (const prompt of SAMPLE_PROMPTS) for (const tool of prompt.tools) expect(base.has(tool)).toBe(true);
  for (const prompt of [...SAMPLE_PROMPTS, ...GMAIL_PROMPTS]) for (const tool of prompt.tools) expect(enabled.has(tool)).toBe(true);
});
it.each([false, true])('gates Gmail guide, sample prompts and landing on the public capability: %s', async enabled => {
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox', gmailEnabled: enabled });
  const guide = render(<GuidePage navigate={() => {}} />);
  await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());
  if (enabled) {
    fireEvent.click(await screen.findByRole('button', { name: 'Gmail' }));
    expect(within(document.getElementById('service-guide-detail')!).getByRole('heading', { name: 'Gmail' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Kết nối Gmail/ })).toBeTruthy();
  } else expect(screen.queryByText('Gmail')).toBeNull();
  fireEvent.click(document.getElementById('tab-btn-prompts')!);
  if (enabled) expect(await screen.findByText('Trả lời thư nhóm ATI')).toBeTruthy();
  else expect(screen.queryByText('Trả lời thư nhóm ATI')).toBeNull();
  guide.unmount(); render(<LandingPage navigate={() => {}} />);
  if (enabled) await screen.findByText('Gmail · Của riêng bạn'); else expect(screen.queryByText(/Gmail/)).toBeNull();
});
