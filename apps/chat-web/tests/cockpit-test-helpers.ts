import { fireEvent, screen, within } from '@testing-library/react';
export function closeCockpitDialog() {
  const dialog = screen.queryByRole('dialog');
  if (dialog) fireEvent.keyDown(document, { key:'Escape' });
}
export async function openHistory() {
  closeCockpitDialog();
  fireEvent.click(await screen.findByRole('button', { name:'Mở danh sách hội thoại' }));
}
export async function transcriptText(text: string) {
  const log = screen.queryByRole('log');
  if (log && within(log).queryByText(text)) return within(log).getByText(text);
  closeCockpitDialog();
  fireEvent.click(await screen.findByRole('button', { name:'Xem hội thoại' }));
  return within(screen.getByRole('log')).findByText(text);
}
